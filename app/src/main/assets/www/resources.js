/* Aria Edit — learning resources. Data is static; DOM is built with textContent only. */
(function () {
  'use strict';
  var ALLOWED = ['faradars.org', 'www.youtube.com', 'youtube.com', 'www.udemy.com'];
  var COURSES = [
    { id: 'khosravi', name: 'آموزش تدوین ویدیو با Premiere Pro ۲۰۲۵', teacher: 'استاد علی خسروی', platform: 'فرادرس — ۹ ساعت، ۲۰ فصل، ۸۲ درس',
      desc: 'دوره کامل و جامع پریمیر پرو ۲۰۲۵ از آشنایی با محیط نرم‌افزار تا خروجی گرفتن، آزمون جامع و گواهینامه.',
      topics: ['فصل ۱: آشنایی با نرم‌افزار پریمیر (پروژه جدید، Workspace، ایجاد سکانس)', 'فصل ۲: آشنایی با پنل‌های مهم (Project، تایم‌لاین، مانیتورها، Effect و Effect Control)', 'فصل ۳: کاربرد Source Monitor (مارکرها، Insert و Overwrite)', 'فصل ۴: کاربرد Time Line (جداسازی صدا و تصویر، Razor، Slow/Fast Motion، Rate Stretch)', 'فصل ۵: کاربرد Program Monitor (منوی Edit، History، Copy & Paste)', 'فصل ۶: تدوین خودکار و سایر ابزارها (Automate Sequence، انواع کات)', 'فصل ۷: تغییر خصوصیات کلیپ (ابعاد، شفافیت، چرخش، Crop، مد ترکیبی)', 'فصل ۸: انیمیشن (کی‌فریم، شتاب، Nest و Subsequence)', 'فصل ۹: Transition', 'فصل ۱۰: افزودن افکت‌ها (Adjustment Layer، Blur، Distort، پریست و پلاگین)', 'فصل ۱۱: گرافیک و موشن‌گرافیک (متن، شکل، Essential Graphics، زیرنویس خودکار)', 'فصل ۱۲: تدوین پیشرفته (Multicam، Time Remapping)', 'فصل ۱۳: اصلاح رنگ (Lumetri، Look سینمایی، ذخیره Preset)', 'فصل ۱۴: تنظیم و ویرایش صدا (ضبط صدا، Remix، Essential Sound)', 'فصل ۱۵: ماسک و پرده سبز (Track Matte)', 'فصل ۱۶: سایر قابلیت‌ها (Auto Frame، Proxy، لرزش‌گیری، Echo، Freeze Frame)', 'فصل ۱۷: خروجی گرفتن (فرمت‌ها، شبکه‌های اجتماعی، Media Encoder)', 'فصل ۱۸: راهنمایی ادامه مسیر', 'فصل ۱۹: آزمون جامع و گواهینامه', 'فصل ۲۰: محتوای تکمیلی (خلاصه متنی، واژه‌نامه، پرسش‌های متداول، مشاغل مرتبط)'],
      url: 'https://faradars.org/courses/video-editing-using-premiere-pro-2025-fvadb306' },
    { id: 'eskandari', name: 'آموزش ادوبی پریمیر پرو ۲۰۲۴ (مسترکلاس)', teacher: 'استاد زاروان اسکندری', platform: 'یوتیوب (کانال VideoPost) — رایگان، حدود ۱۲ ساعت',
      desc: 'پلی‌لیست مسترکلاس پریمیر پرو ۲۰۲۴ با تدریس تدوینگر حرفه‌ای سینما و تلویزیون.',
      topics: ['آشنایی با محیط نرم‌افزار و ورک‌اسپیس‌ها', 'تنظیمات اولیه برنامه و ستینگ‌ها', 'مدیریت فایل‌ها و پروجکت تمپلیت‌ها', 'ساخت تایم‌لاین و سکانس جدید', 'سورس مانیتور و پروگرم مانیتور', 'ادیت در تایم‌لاین', 'کلیدهای میانبر و مارکرها', 'افکت‌ها و پنل Effect Control', 'انیمیشن و کی‌فریم', 'تایم‌لاین پیشرفته', 'ترنزیشن‌ها', 'تغییر سرعت ویدیو', 'پراکسی برای ادیت روی سیستم ضعیف', 'کار با صدا', 'ماسک و ترک کردن سوژه', 'اصلاح رنگ با Lumetri Color', 'کروماکی (پرده سبز)', 'پنل Essential Graphics', 'ساخت زیرنویس و کپشن', 'تغییر قاب اتوماتیک و اندازه فریم برای شبکه‌های اجتماعی', 'ادیت چند دوربینه', 'صداگذاری پیشرفته', 'خروجی گرفتن و تنظیمات خروجی'],
      url: 'https://www.youtube.com/playlist?list=PLpZ6IYEaF8g3FvrfJYj-q_jawHdvU6mq1' },
    { id: 'udemy', name: 'Complete Adobe Premiere Pro Megacourse: Beginner to Expert', teacher: 'دوره مکمل — Adam Bowles و Hosna Kachooee', platform: 'Udemy (انگلیسی)',
      desc: 'دوره تکمیلی انگلیسی؛ از وارد کردن و مدیریت مدیا تا کی‌فریم، رنگ‌بندی و گرافیک.',
      topics: ['دانلود Premiere Pro', 'معرفی کلی Adobe Premiere Pro', 'تنظیم اولیه Premiere Pro', 'ورود و مدیریت مدیا و برش کلیپ‌ها', 'ترنزیشن‌ها و صدا', 'انیمیشن با کی‌فریم', 'رنگ‌بندی (Color Grading)', 'Essential Graphics و افکت‌های پویا'],
      url: 'https://www.udemy.com/course/complete-adobe-premiere-pro-megacourse-beginner-to-expert/' }
  ];
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function safe(u) { try { var p = new URL(u); return p.protocol === 'https:' && ALLOWED.indexOf(p.hostname) > -1; } catch (e) { return false; } }
  function render() {
    var root = document.getElementById('resourcesRoot'); if (!root) return; root.textContent = '';
    COURSES.forEach(function (c) {
      var card = el('details', 'card rs-card'), sum = el('summary', 'rs-sum');
      sum.append(el('span', 'rs-name', c.name), el('span', 'rs-teacher', c.teacher)); card.appendChild(sum);
      var b = el('div', 'rs-body');
      b.append(el('div', 'rs-label', 'پلتفرم'), el('p', null, c.platform), el('div', 'rs-label', 'توضیحات'), el('p', null, c.desc), el('div', 'rs-label', 'سرفصل‌ها'));
      if (c.topics.length) { var ul = el('ul', 'rs-list'); c.topics.forEach(function (t) { ul.appendChild(el('li', null, t)); }); b.appendChild(ul); }
      else b.appendChild(el('p', 'rs-note', 'سرفصل‌های دقیق این دوره هنوز در برنامه وارد نشده؛ فعلاً از صفحه دوره ببینید.'));
      b.appendChild(el('div', 'rs-label', 'لینک آموزش'));
      if (safe(c.url)) { var a = el('a', 'ghost-btn primary rs-link', 'باز کردن دوره'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; b.appendChild(a); }
      card.appendChild(b); root.appendChild(card);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
