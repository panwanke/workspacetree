/*
 * WorkBuddy 发布入口的浏览器引导脚本（由 scripts/prepare-release.mjs 内联进 index.html）。
 *
 * 背景：分享网关在首次访问 ?sharecode=... 时返回主文档并下发 __wb_rsc cookie，
 * 之后只靠该 cookie 放行子资源。内嵌预览 / 隐私浏览器若拒绝写入或发送该 cookie，
 * JS 与 CSS 会全部 403，页面只剩空的 #root —— 表现为纯白屏。
 *
 * 对策：把入口 URL 的查询串透传给每个同源资源，使子资源不再依赖 cookie；
 * 资源路径使用相对路径，兼容不同静态根；任何加载失败都给出可见提示而非白屏。
 *
 * 本文件是浏览器脚本，占位符由 prepare-release.mjs 替换，不要直接执行。
 */
(function () {
  var scriptSrc = '__SCRIPT_SRC__';
  var styleHref = '__STYLE_HREF__';
  var query = window.location.search || '';

  function tagged(url) {
    if (!query) return url;
    return url + (url.indexOf('?') < 0 ? query : '&' + query.slice(1));
  }

  function status(title, detail) {
    var box = document.getElementById('boot-status');
    if (!box) return;
    box.innerHTML = '<strong>' + title + '</strong><span>' + detail + '</span>';
  }

  function fail(what) {
    status(
      '资源加载失败',
      what + '未能加载。请使用完整的分享链接（带 ?sharecode=）打开，或换用外部浏览器重试。',
    );
  }

  // 图标同样由引导脚本注入，确保 URL 带分享码（静态标签会丢失查询串）。
  // 文件名由 scripts/generate-icons.mjs 固定生成。
  var icons = [
    ['icon', './favicon.svg', 'image/svg+xml', ''],
    ['alternate icon', './favicon.png', 'image/png', '32x32'],
    ['apple-touch-icon', './apple-touch-icon.png', '', '180x180'],
  ];
  icons.forEach(function (item) {
    var link = document.createElement('link');
    link.rel = item[0];
    if (item[2]) link.type = item[2];
    if (item[3]) link.sizes = item[3];
    link.href = tagged(item[1]);
    document.head.appendChild(link);
  });

  if (styleHref) {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.crossOrigin = '';
    css.href = tagged(styleHref);
    css.onerror = function () {
      fail('样式文件');
    };
    document.head.appendChild(css);
  }

  var script = document.createElement('script');
  script.type = 'module';
  script.crossOrigin = '';
  script.src = tagged(scriptSrc);
  script.onerror = function () {
    fail('脚本文件');
  };
  document.head.appendChild(script);

  // 运行时同源静态资源（例如 sql-wasm.wasm）同样透传分享码；
  // 刻意不动 API 请求，避免污染云 SDK 的查询串。
  var staticAsset = /\.(?:wasm|js|css|svg|png|jpg|jpeg|webp|gif|woff2?|json)(?:[?#]|$)/i;
  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.charAt(0) === '/' && staticAsset.test(input)) {
      input = tagged(input);
    }
    return nativeFetch.call(window, input, init);
  };

  // React 渲染的 <img src="/assets/logo-xxx.svg"> 由浏览器直接发起，不走 fetch/XHR。
  // 只给「同源绝对路径的静态资源」补分享码，data:/blob:/跨域 URL 保持原样。
  try {
    var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (srcDescriptor && srcDescriptor.get && srcDescriptor.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: srcDescriptor.enumerable,
        get: function () {
          return srcDescriptor.get.call(this);
        },
        set: function (value) {
          if (typeof value === 'string' && value.charAt(0) === '/' && staticAsset.test(value)) {
            value = tagged(value);
          }
          srcDescriptor.set.call(this, value);
        },
      });
    }
  } catch {
    // 浏览器不允许改写时保持原行为，最多只是装饰性图标加载失败。
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && url.charAt(0) === '/' && staticAsset.test(url)) {
      arguments[1] = tagged(url);
    }
    return nativeOpen.apply(this, arguments);
  };

  // React 挂载成功后会移除 #boot-status；若它一直在，说明脚本没有真正跑起来。
  window.setTimeout(function () {
    if (document.getElementById('boot-status')) {
      status(
        '启动超时',
        '应用脚本可能未能执行。请使用完整的分享链接（带 ?sharecode=）打开，或换用外部浏览器重试。',
      );
    }
  }, 20000);
})();
