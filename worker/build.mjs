// يجمع ملفات السيرفر في ملف واحد dist/worker.js جاهز للصق في محرر Cloudflare
// التشغيل: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const order = [
  'lib/util.js', 'lib/google.js', 'lib/firestore.js', 'lib/notify.js', 'lib/context.js',
  'routes/coupons.js', 'routes/checkout.js', 'routes/wallet.js', 'routes/push.js', 'routes/admin.js', 'index.js',
];
let out = '// ميثاق | MITHAQ API — ملف مجمّع تلقائياً (لا تعدّل هنا، عدّل src/ ثم node build.mjs)\n';
for (const f of order) {
  let src = readFileSync(new URL(`./src/${f}`, import.meta.url), 'utf8');
  src = src.replace(/^import \* as (\w+) from '\.\/routes\/admin\.js';$/m, (_, n) => {
    const names = [...readFileSync(new URL('./src/routes/admin.js', import.meta.url), 'utf8').matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
    return `const ${n} = { ${names.join(', ')} };`;
  });
  src = src.replace(/^import [^;]+;$/gm, '');
  if (f !== 'index.js') src = src.replace(/^export (?=(async function|function|const|class|let))/gm, '');
  out += `\n// ===== ${f} =====\n${src.trim()}\n`;
}
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/worker.js', import.meta.url), out);
console.log('built dist/worker.js', out.length, 'bytes');
