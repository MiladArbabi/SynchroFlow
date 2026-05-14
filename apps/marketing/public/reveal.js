// public/reveal.js
// IntersectionObserver reveal animation — loaded as a static script in ArticleLayout.
// Adds 'in' class to .reveal elements when they enter the viewport.
// Cached by browser across page navigations — never re-sent as inline HTML.
(function () {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.07 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
})();