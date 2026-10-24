(function () {
	'use strict';

	var TITLES = {
		'about': 'About',
		'projects': 'Projects',
		'tech-stack': 'Tech stack',
		'links': 'Links',
		'education-achievements': 'Education and achievements',
		'blog': 'blog'
	};
	var DEFAULT_PAGE = 'about';
	var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	function pad(n) {
		return n < 10 ? '0' + n : String(n);
	}

	// e.g. "24 Oct 2026": day first, month as a word, so it reads the same everywhere
	function renderDate() {
		var el = document.querySelector('[data-today]');
		if (!el) return;
		var now = new Date();
		el.textContent = now.getDate() + ' ' + MONTHS[now.getMonth()] + ' ' + now.getFullYear();
		el.setAttribute('datetime', now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()));
	}

	function currentPage() {
		var name = decodeURIComponent(location.hash.slice(1));
		return Object.prototype.hasOwnProperty.call(TITLES, name) ? name : DEFAULT_PAGE;
	}

	function route() {
		var name = currentPage();

		document.querySelectorAll('.page').forEach(function (page) {
			page.classList.toggle('is-active', page.getAttribute('data-page') === name);
		});

		document.querySelectorAll('.pages-nav a').forEach(function (link) {
			if (link.getAttribute('href') === '#' + name) {
				link.setAttribute('aria-current', 'page');
			} else {
				link.removeAttribute('aria-current');
			}
		});

		document.title = TITLES[name] + ' · Jasleen Kalra';
		window.scrollTo(0, 0);
	}

	if ('scrollRestoration' in history) {
		history.scrollRestoration = 'manual';
	}

	renderDate();
	route();
	window.addEventListener('hashchange', route);
})();
