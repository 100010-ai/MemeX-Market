export function startPreloader() {
  const assets = Array.from({ length: 25 }, (_, i) => `/assets/cars/${i + 1}.webp`);
  const tips = [
    'Идеальный SHIFT сохраняет больше оборотов после переключения.',
    'Уровень КПП расширяет рабочее окно, но не заменяет точность.',
    'Секреты и service_role никогда не должны попадать в клиент.',
    'Сервер проверяет Telegram initData до чувствительных операций.'
  ];
  let done = 0;
  const total = assets.length + 1;
  const bar = document.getElementById('pl-bar');
  const pct = document.getElementById('pl-percent');
  const sub = document.getElementById('pl-sub');
  const tip = document.getElementById('pl-tip');
  const paint = (label?: string) => {
    const value = Math.min(100, Math.round((done / total) * 100));
    if (bar) bar.style.width = `${value}%`;
    if (pct) pct.textContent = `${value}%`;
    if (sub && label) sub.textContent = label;
  };
  const finish = () => {
    paint('Готово');
    window.setTimeout(() => {
      const preloader = document.getElementById('preloader');
      preloader?.classList.add('hide');
      window.setTimeout(() => preloader?.remove(), 450);
    }, 120);
  };
  const step = () => { done += 1; paint('Загрузка ассетов'); if (done >= total) finish(); };
  assets.forEach((src) => { const img = new Image(); img.onload = step; img.onerror = step; img.src = src; });
  let index = 0;
  const timer = window.setInterval(() => { index = (index + 1) % tips.length; if (tip) tip.textContent = tips[index]; }, 900);
  step();
  window.setTimeout(() => { window.clearInterval(timer); if (done < total) { done = total; finish(); } }, 5_000);
  return () => window.clearInterval(timer);
}
