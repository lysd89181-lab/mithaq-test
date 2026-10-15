import { empty } from '../components/blocks.js';

export default async function page(el) {
  el.innerHTML = `<div class="page">${empty('alert', 'الصفحة هذي مش موجودة', '', '<a class="btn btn-primary" href="#/">الرئيسية</a>')}</div>`;
}
