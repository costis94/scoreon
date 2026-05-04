(function () {
  function t(key, substitutions) {
    return chrome.i18n.getMessage(key, substitutions) || key;
  }

  function applyI18n(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18n);
    });

    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
    });

    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.dataset.i18nTitle));
    });

    root.querySelectorAll("[data-i18n-value]").forEach((el) => {
      el.value = t(el.dataset.i18nValue);
    });
  }

  window.t = t;
  window.applyI18n = applyI18n;

  document.addEventListener("DOMContentLoaded", () => applyI18n());
})();
