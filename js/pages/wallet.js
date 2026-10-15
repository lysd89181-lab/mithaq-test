// المحفظة: الرصيد، شحن، سجل المعاملات
import { html, raw, copyText, fmtDate, statusOf } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { state, fmt, subscribe, usdRate } from '../core/state.js';
import { db, collection, query, where, limit, onSnapshot } from '../core/firebase.js';
import { api } from '../core/api.js';
import { toast, toastErr, withLoading } from '../core/ui.js';
import { pageHead, empty } from '../components/blocks.js';

const METHOD_UI = {
  libyana: { icon: 'phone', valueLabel: 'الرقم اللي حوّلت منه', valuePh: '09XXXXXXXX', amountLabel: 'القيمة المحوّلة (د.ل)',
    help: 'حوّل الرصيد لأحد الأرقام تحت، وبعدها اكتب رقمك والقيمة. نراجع التحويل ونشحن محفظتك.' },
  binance: { icon: 'coin', valueLabel: 'معرّف Binance اللي حوّلت منه (ID)', valuePh: '123456789', amountLabel: 'المبلغ بالدولار ($)',
    help: 'حوّل عبر Binance Pay للمعرّف تحت، وبعدها اكتب معرّفك والمبلغ.' },
  cards: { icon: 'card', valueLabel: 'رقم كرت التعبئة كامل', valuePh: 'XXXX XXXX XXXX', amountLabel: 'قيمة الكرت (د.ل)',
    help: 'اكتب رقم كرت ليبيانا أو مدار كامل وقيمته، ونشحن محفظتك بعد التحقق.' },
};
const TX = {
  deposit: { label: 'شحن المحفظة', icon: 'wallet' },
  purchase: { label: 'شراء', icon: 'cart' },
  refund: { label: 'استرجاع', icon: 'refresh' },
  manual_credit: { label: 'إضافة من الإدارة', icon: 'plus' },
  manual_debit: { label: 'خصم من الإدارة', icon: 'minus' },
};

export default async function page(el) {
  const s = state.settings;
  const methods = (s.payment_methods?.length ? s.payment_methods : [{ id: 'libyana', title: 'ليبيانا ومدار' }, { id: 'binance', title: 'بايننس' }, { id: 'cards', title: 'كروت تعبئة' }])
    .filter((m) => m.active !== false && METHOD_UI[m.id]);
  let picked = null;
  let tab = 'tx';
  let txs = [];
  let deps = [];

  el.innerHTML = html`<div class="page">
    ${raw(pageHead('المحفظة'))}
    <div class="two-col">
      <div class="stack-lg">
        <div class="balance-card">
          <span class="muted">رصيدك الحالي</span>
          <div class="amount num" id="wBal">${fmt(state.profile?.balance || 0)}</div>
          <div class="hint" style="margin-top:6px">${state.currency === 'USD' ? `1$ = ${usdRate()} د.ل` : ''}</div>
        </div>
        <section class="panel">
          <div class="panel-title"><h2>شحن الرصيد</h2></div>
          ${methods.length ? html`<div class="methods" role="radiogroup" aria-label="طريقة الدفع">${methods.map((m) => html`<button class="method" role="radio" aria-checked="false" data-m="${m.id}"><span class="mi">${icon(METHOD_UI[m.id].icon)}</span><span>${m.title.replace(/^[^\p{L}]+/u, '')}</span></button>`)}</div>`
            : html`<p class="muted">الشحن متوقف مؤقتاً. تواصل مع الدعم.</p>`}
          <div id="mForm"></div>
          <p class="hint" style="margin-top:14px">${icon('clock', 'sm')} وقت المراجعة: ${s.processing_time || 'من دقيقة إلى 3 ساعات'}</p>
        </section>
      </div>
      <section class="panel">
        <div class="segmented" style="margin-bottom:8px"><button data-t="tx" class="active">المعاملات</button><button data-t="dep">طلبات الشحن</button></div>
        <div id="hist"><div class="skel" style="height:160px;margin-top:10px"></div></div>
      </section>
    </div>
  </div>`.html;

  const form = el.querySelector('#mForm');
  const drawForm = () => {
    if (!picked) { form.innerHTML = ''; return; }
    const ui = METHOD_UI[picked];
    const nums = (s.libyana_numbers || []).filter((n) => n.active !== false);
    const accounts = picked === 'libyana' ? nums.map((n) => ({ label: n.label, value: n.number }))
      : picked === 'binance' ? [{ label: 'Binance ID', value: s.binance_id || '' }].filter((a) => a.value) : [];
    form.innerHTML = html`<div class="stack" style="margin-top:16px">
      <p class="muted" style="font-size:var(--fs-sm)">${ui.help}${picked === 'binance' ? ` السعر المعتمد: 1$ = ${Number(s.binance_rate) || 11} د.ل.` : ''}</p>
      ${accounts.map((a) => html`<div class="acct"><div><div class="hint">${a.label}</div><b>${a.value}</b></div>
        <button class="btn btn-ghost btn-sm" data-copy="${a.value}">${icon('copy', 'sm')}<span>نسخ</span></button></div>`)}
      <div class="field"><label for="dVal">${ui.valueLabel}</label><input id="dVal" class="input ltr" dir="ltr" placeholder="${ui.valuePh}" autocomplete="off" maxlength="80"></div>
      <div class="field"><label for="dAmt">${ui.amountLabel}</label><input id="dAmt" class="input ltr" dir="ltr" type="number" inputmode="decimal" min="1" step="0.01" placeholder="0"></div>
      <p class="hint" id="dConv"></p>
      <button class="btn btn-primary btn-block" id="dSend"><span class="label">إرسال طلب الشحن</span><span class="spin"></span></button>
    </div>`.html;
    form.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = async () => { if (await copyText(b.dataset.copy)) toast('تم النسخ'); }; });
    if (picked === 'binance') {
      form.querySelector('#dAmt').oninput = (e) => {
        const v = Number(e.target.value) || 0;
        form.querySelector('#dConv').textContent = v ? `يتضاف لمحفظتك: ${(v * (Number(s.binance_rate) || 11)).toFixed(3)} د.ل` : '';
      };
    }
    form.querySelector('#dSend').onclick = (e) => withLoading(e.currentTarget, async () => {
      const value = form.querySelector('#dVal').value.trim();
      const amount = Number(form.querySelector('#dAmt').value);
      if (value.length < 4) return toast(`أدخل ${ui.valueLabel}`, 'err');
      if (!(amount > 0)) return toast('أدخل المبلغ', 'err');
      try {
        const r = await api('/v1/deposit', { method: picked, value, amount });
        toast(`وصلنا طلبك (${r.invoiceNumber}). نبلغوك أول ما يتشحن`);
        form.querySelector('#dVal').value = '';
        form.querySelector('#dAmt').value = '';
        tab = 'dep';
        syncTabs();
        drawHist();
      } catch (err) { toastErr(err); }
    });
  };

  el.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = () => {
      picked = b.dataset.m;
      el.querySelectorAll('[data-m]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', x === b); });
      drawForm();
    };
  });

  const syncTabs = () => el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x.dataset.t === tab));
  el.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { tab = b.dataset.t; syncTabs(); drawHist(); }; });

  const ts = (d) => d.createdAt?.toMillis?.() || 0;
  function drawHist() {
    const box = el.querySelector('#hist');
    if (tab === 'tx') {
      box.innerHTML = txs.length ? html`<div class="list">${txs.map((t) => {
        const k = TX[t.type] || { label: t.type, icon: 'activity' };
        const amt = Number(t.amount) || 0;
        return html`<div class="list-row"><span class="mi" style="width:38px;height:38px;border-radius:11px;background:var(--ink-3);display:grid;place-items:center;color:var(--fog)">${icon(k.icon, 'sm')}</span>
          <div class="grow"><div class="title" style="font-size:var(--fs-sm)">${k.label}</div><div class="sub">${t.note || ''} · ${fmtDate(t.createdAt)}</div></div>
          <b class="num ${amt > 0 ? 'amount-in' : 'amount-out'}">${amt > 0 ? '+' : ''}${fmt(amt)}</b></div>`;
      })}</div>`.html : empty('history', 'ما فيش معاملات بعد', 'أول ما تشحن أو تشتري تظهر هنا.');
    } else {
      box.innerHTML = deps.length ? html`<div class="list">${deps.map((d) => {
        const st = statusOf(d.status);
        return html`<div class="list-row"><div class="grow"><div class="title" style="font-size:var(--fs-sm)">${d.provider || 'شحن'} · <span class="num">${fmt(d.amount)}</span></div>
          <div class="sub"><span class="num">${d.invoiceNumber || ''}</span> · ${fmtDate(d.createdAt)}${d.rejectReason ? ` · ${d.rejectReason}` : ''}</div></div>
          <span class="badge ${st.cls}">${d.status === 'pending' ? 'قيد المراجعة' : st.label}</span></div>`;
      })}</div>`.html : empty('wallet', 'ما فيش طلبات شحن', 'اختر طريقة دفع فوق وابدأ.');
    }
  }

  const uid = state.user.uid;
  const u1 = onSnapshot(query(collection(db, 'wallet_tx'), where('userId', '==', uid), limit(100)), (snap) => {
    txs = snap.docs.map((d) => d.data()).sort((a, b) => ts(b) - ts(a)).slice(0, 50);
    drawHist();
  }, () => { txs = []; drawHist(); });
  const u2 = onSnapshot(query(collection(db, 'deposits'), where('userId', '==', uid), limit(100)), (snap) => {
    deps = snap.docs.map((d) => d.data()).sort((a, b) => ts(b) - ts(a)).slice(0, 50);
    drawHist();
  }, () => { deps = []; drawHist(); });
  const u3 = subscribe((st, p) => { if ('profile' in p || 'currency' in p) el.querySelector('#wBal').textContent = fmt(st.profile?.balance || 0); });
  return () => { u1(); u2(); u3(); };
}
