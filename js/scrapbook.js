(() => {
	'use strict';

	const reducedMotion =
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const rand = (min, max) =>
		Math.random() * (max - min) + min;

	function initDate() {
		const now = new Date();

		const year = now.getFullYear();
		const month = now.getMonth();
		const day = now.getDate();

		const dateText = now
			.toLocaleDateString('en-US', {
				month: 'long',
				day: 'numeric',
				year: 'numeric'
			})
			.toLowerCase();

		const dayOfYear = Math.round(
			(Date.UTC(year, month, day) -
				Date.UTC(year, 0, 0)) /
			86400000
		);

		const page = String(dayOfYear).padStart(2, '0');

		const isoDate =
			`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

		document.querySelectorAll('[data-today]').forEach((el) => {
			el.textContent = `${dateText} · page ${page}`;

			if (el.tagName === 'TIME') {
				el.dateTime = isoDate;
			}
		});
	}

	const DOODLE_PADDING = 24;
	const PIECE_GAP = 14;
	const SCAN_STEP = 10;
	const LAYOUT_RETRIES = 25;
	const LAYOUT_BUDGET_MS = 12;
	const MAX_STAGGER_MS = 50;

	const TAP_MAX_MOVE = 10;
	const TAP_MAX_MS = 500;
	const GHOST_CLICK_MS = 700;

	const shuffleArray = (array) => {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));

			[array[i], array[j]] =
				[array[j], array[i]];
		}

		return array;
	};

	const gcd = (a, b) =>
		b ? gcd(b, a % b) : a;

	function setupDoodles() {
		const layer =
			document.querySelector('.doodle-layer');

		if (!layer) return () => {};

		const doodles =
			[...layer.querySelectorAll('.doodle')];

		if (layer.parentElement !== document.body) {
			document.body.appendChild(layer);
		}

		layer.style.position = 'absolute';
		layer.style.inset = '0';
		layer.style.pointerEvents = 'none';
		layer.style.zIndex = '0';
		layer.style.overflow = 'hidden';

		doodles.forEach((doodle) => {
			doodle.style.position = 'absolute';
			doodle.style.left = '0';
			doodle.style.top = '0';
			doodle.style.pointerEvents = 'none';
			doodle.style.willChange = 'transform';
		});

		function doodleSize(doodle) {
			const style =
				getComputedStyle(doodle);

			return Math.max(
				parseFloat(style.width) || 0,
				parseFloat(style.height) || 0
			) * 1.37;
		}

		function getPageSize() {
			return {
				width: layer.clientWidth,
				height: layer.clientHeight
			};
		}

		let lastBox = {
			width: 0,
			height: 0
		};

		function scatter() {
			const {
				width: pageWidth,
				height: pageHeight
			} = getPageSize();

			lastBox = {
				width: pageWidth,
				height: pageHeight
			};

			doodles.forEach((doodle) => {
				const size =
					doodleSize(doodle);

				const maxX = Math.max(
					DOODLE_PADDING,
					pageWidth -
						size -
						DOODLE_PADDING
				);

				const maxY = Math.max(
					DOODLE_PADDING,
					pageHeight -
						size -
						DOODLE_PADDING
				);

				const x =
					rand(
						DOODLE_PADDING,
						maxX
					);

				const y =
					rand(
						DOODLE_PADDING,
						maxY
					);

				const angle =
					rand(-30, 30);

				doodle.style.setProperty(
					'--delay',
					`${Math.round(
						rand(
							0,
							MAX_STAGGER_MS
						)
					)}ms`
				);

				doodle.style.transform =
					`translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ` +
					`rotate(${angle.toFixed(1)}deg)`;
			});
		}

		layer.classList.add('is-placing');

		scatter();

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				layer.classList.remove(
					'is-placing'
				);

				layer.classList.add(
					'is-ready'
				);
			});
		});

		let settleTimer;

		const rescatterIfResized = () => {
			clearTimeout(settleTimer);

			settleTimer =
				setTimeout(() => {
					const {
						width,
						height
					} = getPageSize();

					if (
						Math.abs(
							width -
								lastBox.width
						) < 2 &&
						Math.abs(
							height -
								lastBox.height
						) < 2
					) {
						return;
					}

					scatter();
				}, 100);
		};

		window.addEventListener(
			'load',
			rescatterIfResized
		);

		if (document.fonts) {
			document.fonts.ready.then(
				rescatterIfResized
			);
		}

		document
			.querySelectorAll('img')
			.forEach((img) => {
				if (img.complete) return;

				img.addEventListener(
					'load',
					rescatterIfResized,
					{ once: true }
				);
			});

		if (typeof ResizeObserver === 'function') {
			new ResizeObserver(
				rescatterIfResized
			).observe(document.body);
		}

		return scatter;
	}

	function setupBlocks(zone) {
		const blocks =
			zone
				? [...zone.querySelectorAll(
					'[data-shuffle]'
				)]
				: [];

		let shuffled = false;

		const overlapArea =
			(x, y, w, h, other) => {
				const overlapW =
					Math.min(
						x + w,
						other.x + other.w
					)
					-
					Math.max(
						x,
						other.x
					)
					+
					PIECE_GAP;

				const overlapH =
					Math.min(
						y + h,
						other.y + other.h
					)
					-
					Math.max(
						y,
						other.y
					)
					+
					PIECE_GAP;

				return (
					overlapW > 0 &&
					overlapH > 0
				)
					? overlapW * overlapH
					: 0;
			};

		function scatterLayout(
			items,
			zoneWidth,
			zoneHeight
		) {
			const bySize =
				[...items].sort(
					(a, b) =>
						b.w * b.h -
						a.w * a.h
				);

			const deadline =
				performance.now() +
				LAYOUT_BUDGET_MS;

			let best = null;
			let bestOverlap = Infinity;

			for (
				let attempt = 0;
				attempt < LAYOUT_RETRIES &&
				bestOverlap > 0;
				attempt++
			) {
				if (
					attempt > 0 &&
					performance.now() >
						deadline
				) {
					break;
				}

				const placed = [];
				let layoutOverlap = 0;

				bySize.forEach((item) => {
					const maxX =
						Math.max(
							0,
							zoneWidth -
								item.w
						);

					const maxY =
						Math.max(
							0,
							zoneHeight -
								item.h
						);

					const offsetX =
						rand(
							0,
							Math.min(
								SCAN_STEP,
								maxX
							)
						);

					const offsetY =
						rand(
							0,
							Math.min(
								SCAN_STEP,
								maxY
							)
						);

					const cols =
						Math.floor(
							(maxX - offsetX) /
							SCAN_STEP
						) + 1;

					const rows =
						Math.floor(
							(maxY - offsetY) /
							SCAN_STEP
						) + 1;

					const count =
						cols * rows;

					let stride =
						Math.max(
							1,
							Math.round(
								count * 0.618
							)
						);

					while (
						gcd(
							stride,
							count
						) !== 1
					) {
						stride++;
					}

					const start =
						Math.floor(
							Math.random() *
							count
						);

					let spot = null;

					for (
						let k = 0;
						k < count;
						k++
					) {
						const index =
							(start +
								k * stride) %
							count;

						const x =
							offsetX +
							(index % cols) *
							SCAN_STEP;

						const y =
							offsetY +
							Math.floor(
								index / cols
							) *
							SCAN_STEP;

						let overlap = 0;

						for (
							let p = 0;
							p < placed.length &&
							(
								!spot ||
								overlap <
									spot.overlap
							);
							p++
						) {
							overlap +=
								overlapArea(
									x,
									y,
									item.w,
									item.h,
									placed[p]
								);
						}

						if (
							!spot ||
							overlap <
								spot.overlap
						) {
							spot = {
								item,
								x,
								y,
								w: item.w,
								h: item.h,
								overlap
							};
						}

						if (
							overlap === 0
						) {
							break;
						}
					}

					placed.push(spot);

					layoutOverlap +=
						spot.overlap;
				});

				if (
					layoutOverlap <
					bestOverlap
				) {
					best = placed;
					bestOverlap =
						layoutOverlap;
				}
			}

			return best;
		}

		function stackLayout(
			items,
			zoneWidth,
			zoneHeight
		) {
			const rows =
				items
					.filter(
						(item) =>
							item.w >
							zoneWidth / 2
					)
					.map((item) => [item]);

			let row = [];
			let rowWidth = 0;

			shuffleArray(
				items.filter(
					(item) =>
						item.w <=
						zoneWidth / 2
				)
			).forEach((item) => {
				if (
					row.length &&
					rowWidth +
						PIECE_GAP +
						item.w >
						zoneWidth
				) {
					rows.push(row);

					row = [];
					rowWidth = 0;
				}

				rowWidth +=
					(
						row.length
							? PIECE_GAP
							: 0
					) +
					item.w;

				row.push(item);
			});

			if (row.length) {
				rows.push(row);
			}

			shuffleArray(rows);

			const rowHeights =
				rows.map((r) =>
					Math.max(
						...r.map(
							(item) =>
								item.h
						)
					)
				);

			const spare =
				Math.max(
					0,
					zoneHeight -
						rowHeights.reduce(
							(sum, h) =>
								sum + h,
							0
						)
				);

			const weights =
				rows.map(
					(_, i) =>
						i === 0
							? rand(0, 0.3)
							: rand(0.6, 1.4)
				);

			const weightTotal =
				weights.reduce(
					(sum, w) =>
						sum + w,
					0
				) +
				rand(0, 0.3);

			const placed = [];

			let y = 0;

			rows.forEach((r, i) => {
				y +=
					(spare *
						weights[i]) /
					weightTotal;

				const usedWidth =
					r.reduce(
						(sum, item) =>
							sum + item.w,
						0
					) +
					PIECE_GAP *
						(r.length - 1);

				let x =
					rand(
						0,
						Math.max(
							0,
							zoneWidth -
								usedWidth
						)
					);

				r.forEach((item) => {
					placed.push({
						item,
						x,
						y:
							y +
							rand(
								0,
								Math.max(
									0,
									rowHeights[i] -
										item.h
								)
							)
					});

					x +=
						item.w +
						PIECE_GAP;
				});

				y += rowHeights[i];
			});

			return placed;
		}

		function shuffle() {
			if (!blocks.length) {
				return;
			}

			const zoneWidth =
				zone.clientWidth;

			const zoneHeight =
				zone.clientHeight;

			const items =
				blocks.map((el) => ({
					el,

					homeX:
						el.offsetLeft,

					homeY:
						el.offsetTop,

					w:
						el.offsetWidth,

					h:
						el.offsetHeight
				}));

			const crowded =
				items.some(
					(item) =>
						item.w >
						zoneWidth * 0.75
				);

			const layout =
				crowded
					? stackLayout(
						items,
						zoneWidth,
						zoneHeight
					)
					: scatterLayout(
						items,
						zoneWidth,
						zoneHeight
					);

			if (!layout) {
				return;
			}

			layout.forEach(
				({ item, x, y }) => {
					item.el.style.setProperty(
						'--delay',
						`${Math.round(
							rand(
								0,
								MAX_STAGGER_MS
							)
						)}ms`
					);

					item.el.style.translate =
						`${(
							x -
							item.homeX
						).toFixed(1)}px ` +
						`${(
							y -
							item.homeY
						).toFixed(1)}px`;
				}
			);

			shuffled = true;
		}

		return {
			shuffle,
			isShuffled: () =>
				shuffled
		};
	}

	function initShuffle() {
		const zone =
			document.querySelector(
				'[data-zone="shuffle"]'
			);

		const scatterDoodles =
			setupDoodles();

		const blocks =
			setupBlocks(zone);

		const reshuffle = () => {
			if (blocks) {
				blocks.shuffle();
			}

			scatterDoodles();
		};

		function isShuffleSpot(target) {
			if (!(target instanceof Element)) {
				return true;
			}

			return !target.closest(
				'a, button, input, textarea, ' +
				'select, option, video, audio, iframe, ' +
				'.polaroid, [data-shuffle], ' +
				'.route-stage, .route-zone'
			);
		}

		let lastTapShuffle = 0;

		document.addEventListener(
			'click',
			(event) => {
				if (
					Date.now() -
						lastTapShuffle <
					GHOST_CLICK_MS
				) {
					return;
				}

				if (
					isShuffleSpot(
						event.target
					)
				) {
					reshuffle();
				}
			}
		);

		let touch = null;

		document.addEventListener(
			'touchstart',
			(event) => {
				if (
					event.touches.length !==
					1
				) {
					touch = null;
					return;
				}

				const point =
					event.touches[0];

				touch = {
					x:
						point.clientX,

					y:
						point.clientY,

					time:
						Date.now(),

					target:
						event.target
				};
			},
			{ passive: true }
		);

		document.addEventListener(
			'touchmove',
			(event) => {
				if (!touch) {
					return;
				}

				const point =
					event.touches[0];

				if (
					Math.hypot(
						point.clientX -
							touch.x,

						point.clientY -
							touch.y
					) >
					TAP_MAX_MOVE
				) {
					touch = null;
				}
			},
			{ passive: true }
		);

		document.addEventListener(
			'touchend',
			() => {
				if (
					touch &&
					Date.now() -
						touch.time <
						TAP_MAX_MS &&
					isShuffleSpot(
						touch.target
					)
				) {
					lastTapShuffle =
						Date.now();

					reshuffle();
				}

				touch = null;
			},
			{ passive: true }
		);

		document.addEventListener(
			'touchcancel',
			() => {
				touch = null;
			},
			{ passive: true }
		);

		let lastWidth =
			window.innerWidth;

		let resizeTimer;

		window.addEventListener(
			'resize',
			() => {
				if (
					window.innerWidth ===
					lastWidth
				) {
					return;
				}

				lastWidth =
					window.innerWidth;

				clearTimeout(
					resizeTimer
				);

				resizeTimer =
					setTimeout(() => {
						scatterDoodles();

						if (
							blocks &&
							blocks.isShuffled()
						) {
							blocks.shuffle();
						}
					}, 250);
			}
		);
	}

	function initPolaroids() {
		document
			.querySelectorAll('.polaroid')
			.forEach((card) => {
				if (
					!card.style.getPropertyValue(
						'--rot'
					)
				) {
					const sign =
						Math.random() <
						0.5
							? -1
							: 1;

					card.style.setProperty(
						'--rot',
						`${(
							sign *
							rand(1.5, 6)
						).toFixed(1)}deg`
					);
				}

				const lift = () =>
					card.classList.add(
						'is-lifted'
					);

				const drop = () =>
					card.classList.remove(
						'is-lifted'
					);

				card.addEventListener(
					'mouseenter',
					lift
				);

				card.addEventListener(
					'mouseleave',
					drop
				);

				card.addEventListener(
					'focus',
					lift
				);

				card.addEventListener(
					'blur',
					drop
				);

				card.addEventListener(
					'pointerup',
					(event) => {
						if (
							event.pointerType ===
							'touch'
						) {
							card.classList.toggle(
								'is-lifted'
							);
						}
					}
				);
			});
	}

	const DRAWABLE =
		'path, line, polyline, polygon, rect, circle, ellipse';

	function initDrawOn() {
		const groups =
			[
				...document.querySelectorAll(
					'[data-draw]'
				)
			];

		if (!groups.length) {
			return;
		}

		groups.forEach((group) => {
			group
				.querySelectorAll(DRAWABLE)
				.forEach((shape, i) => {
					if (
						typeof shape.getTotalLength ===
						'function'
					) {
						shape.style.setProperty(
							'--len',
							`${shape
								.getTotalLength()
								.toFixed(1)}px`
						);
					}

					shape.style.setProperty(
						'--i',
						i
					);
				});

			group.classList.add(
				'draw-ready'
			);
		});

		const draw = (group) =>
			group.classList.add(
				'is-drawn'
			);

		if (
			reducedMotion ||
			!(
				'IntersectionObserver'
				in window
			)
		) {
			groups.forEach(draw);

			return;
		}

		const groupsBySvg =
			new Map();

		groups.forEach((group) => {
			const svg =
				group.ownerSVGElement ||
				group;

			if (
				!groupsBySvg.has(svg)
			) {
				groupsBySvg.set(
					svg,
					[]
				);
			}

			groupsBySvg
				.get(svg)
				.push(group);
		});

		const observer =
			new IntersectionObserver(
				(entries) => {
					entries.forEach(
						(entry) => {
							if (
								!entry.isIntersecting
							) {
								return;
							}

							requestAnimationFrame(
								() =>
									requestAnimationFrame(
										() => {
											groupsBySvg
												.get(
													entry.target
												)
												.forEach(
													draw
												);
										}
									)
							);

							observer.unobserve(
								entry.target
							);
						}
					);
				},
				{
					threshold: 0.3
				}
			);

		groupsBySvg.forEach(
			(_, svg) =>
				observer.observe(svg)
		);
	}

	const FLIGHT_MS = 1800;

	function initFlight() {
		const stage =
			document.querySelector(
				'.route-stage'
			);

		if (!stage) {
			return;
		}

		const path =
			stage.querySelector(
				'#flight-path'
			);

		const plane =
			stage.querySelector(
				'#plane'
			);

		const zones =
			stage.querySelectorAll(
				'.route-zone'
			);

		if (!path || !plane) {
			return;
		}

		const totalLength =
			path.getTotalLength();

		let progress = 0;
		let currentTarget = null;
		let rafId = null;
		let hopTimer = null;

		const easeInOut = (t) =>
			t < 0.5
				? 4 * t * t * t
				: 1 -
					Math.pow(
						-2 * t + 2,
						3
					) /
					2;

		function placePlane(
			p,
			heading
		) {
			const at =
				p * totalLength;

			const point =
				path.getPointAtLength(at);

			const behind =
				path.getPointAtLength(
					Math.max(
						0,
						at - 1
					)
				);

			const ahead =
				path.getPointAtLength(
					Math.min(
						totalLength,
						at + 1
					)
				);

			let angle =
				(
					Math.atan2(
						ahead.y -
							behind.y,
						ahead.x -
							behind.x
					) *
					180
				) /
				Math.PI;

			if (heading < 0) {
				angle += 180;
			}

			plane.setAttribute(
				'transform',
				`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) ` +
				`rotate(${angle.toFixed(1)})`
			);
		}

		function animateTo(target) {
			cancelAnimationFrame(
				rafId
			);

			const start =
				progress;

			const heading =
				Math.sign(
					target - start
				) || 1;

			const duration =
				reducedMotion
					? 0
					: FLIGHT_MS *
						Math.abs(
							target - start
						);

			const startTime =
				performance.now();

			currentTarget =
				target;

			stage.classList.add(
				'is-flying'
			);

			const step = (now) => {
				const t =
					duration
						? Math.min(
							1,
							(now -
								startTime) /
								duration
						)
						: 1;

				progress =
					start +
					(target - start) *
						easeInOut(t);

				placePlane(
					progress,
					heading
				);

				if (t < 1) {
					rafId =
						requestAnimationFrame(
							step
						);
				} else {
					rafId = null;
					currentTarget = null;

					stage.classList.remove(
						'is-flying'
					);
				}
			};

			rafId =
				requestAnimationFrame(
					step
				);
		}

		function fly(target) {
			if (
				currentTarget ===
				target
			) {
				return;
			}

			if (hopTimer) {
				clearTimeout(
					hopTimer
				);

				hopTimer = null;

				plane.classList.remove(
					'is-hidden'
				);
			}

			const parkedAtDestination =
				rafId === null &&
				Math.abs(
					progress - target
				) < 0.001;

			if (!parkedAtDestination) {
				animateTo(target);

				return;
			}

			const origin =
				1 - target;

			plane.classList.add(
				'is-hidden'
			);

			hopTimer =
				setTimeout(
					() => {
						hopTimer = null;

						progress =
							origin;

						placePlane(
							progress,
							target - origin
						);

						plane.classList.remove(
							'is-hidden'
						);

						animateTo(
							target
						);
					},
					reducedMotion
						? 0
						: 220
				);
		}

		placePlane(0, 1);

		zones.forEach((zone) => {
			const trigger = () =>
				fly(
					Number(
						zone.dataset.target
					)
				);

			zone.addEventListener(
				'pointerenter',
				trigger
			);

			zone.addEventListener(
				'focus',
				trigger
			);

			zone.addEventListener(
				'click',
				trigger
			);
		});
	}

	function initSocials() {
		const items =
			document.querySelectorAll(
				'.social-item'
			);

		const reveal = (item) =>
			item.classList.add(
				'animated',
				'fadeInUp'
			);

		if (
			!(
				'IntersectionObserver'
				in window
			)
		) {
			items.forEach(reveal);

			return;
		}

		const observer =
			new IntersectionObserver(
				(entries) => {
					entries.forEach(
						(entry) => {
							if (
								!entry.isIntersecting
							) {
								return;
							}

							reveal(
								entry.target
							);

							observer.unobserve(
								entry.target
							);
						}
					);
				},
				{
					threshold: 0.2
				}
			);

		items.forEach(
			(item) =>
				observer.observe(item)
		);
	}

	function initAudio() {
		const music =
			document.getElementById(
				'bg-music'
			);

		const button =
			document.getElementById(
				'music-toggle'
			);

		const label =
			document.getElementById(
				'music-toggle-label'
			);

		const debugOn =
			/[?&]audiodebug=1\b/.test(
				window.location.search
			);

		let debugPanel = null;

		function logAudio(message, detail) {
			if (!debugOn) {
				return;
			}

			const text =
				detail === undefined
					? message
					: message + ' — ' + detail;

			window.console.log(
				'[audio]',
				message,
				detail === undefined
					? ''
					: detail
			);

			if (!debugPanel) {
				debugPanel =
					document.createElement('div');

				debugPanel.className =
					'audio-debug';

				document.body.appendChild(
					debugPanel
				);
			}

			const line =
				document.createElement('p');

			line.textContent = text;

			debugPanel.appendChild(line);

			while (debugPanel.children.length > 14) {
				debugPanel.removeChild(
					debugPanel.firstChild
				);
			}
		}

		function describeError(error) {
			if (!error) {
				return 'unknown error';
			}

			return (
				(error.name || 'Error') +
				': ' +
				(error.message || String(error))
			);
		}

		const source =
			document.getElementById(
				'click-sfx'
			);

		const POOL_SIZE = 5;

		const pool = [];

		let poolIndex = 0;

		let poolPrimed = false;

		if (source) {
			for (
				let i = 0;
				i < POOL_SIZE;
				i += 1
			) {
				const clip =
					new Audio(
						source.getAttribute('src')
					);

				clip.volume = 0.25;

				clip.preload = 'auto';

				pool.push(clip);
			}
		}

		function primeMedia() {
			if (poolPrimed) {
				return;
			}

			poolPrimed = true;

			pool.forEach((clip) => {
				if (clip.readyState > 0) {
					return;
				}

				try {
					clip.load();
				} catch (error) {
					logAudio(
						'pool load failed',
						describeError(error)
					);
				}
			});

			if (
				music &&
				music.readyState === 0
			) {
				try {
					music.load();
				} catch (error) {
					logAudio(
						'music load failed',
						describeError(error)
					);
				}
			}
		}

		function playClick() {
			if (!pool.length) {
				return;
			}

			const clip =
				pool[poolIndex];

			poolIndex =
				(poolIndex + 1) % pool.length;

			if (clip.readyState > 0) {
				try {
					clip.currentTime = 0;
				} catch (error) {
					logAudio(
						'seek refused',
						describeError(error)
					);
				}
			}

			try {
				const played =
					clip.play();

				if (
					played &&
					typeof played.catch ===
						'function'
				) {
					played.catch((error) => {
						logAudio(
							'click sound blocked',
							describeError(error)
						);
					});
				}
			} catch (error) {
				logAudio(
					'click sound threw',
					describeError(error)
				);
			}
		}

		function onGesture() {
			playClick();

			primeMedia();
		}

		if (window.PointerEvent) {
			document.addEventListener(
				'pointerdown',
				onGesture,
				{ capture: true }
			);
		} else {
			document.addEventListener(
				'mousedown',
				onGesture,
				{ capture: true }
			);

			document.addEventListener(
				'touchstart',
				onGesture,
				{ capture: true, passive: true }
			);
		}

		if (!music || !button) {
			return;
		}

		music.volume = 0.35;

		let starting = false;

		function paintButton() {
			const playing =
				!music.paused;

			button.setAttribute(
				'aria-pressed',
				playing
					? 'true'
					: 'false'
			);

			button.setAttribute(
				'aria-label',
				playing
					? 'Turn background music off'
					: 'Turn background music on'
			);

			const icon =
				button.querySelector('i');

			if (icon) {
				icon.className =
					playing
						? 'fa-solid fa-music'
						: 'fa-solid fa-volume-xmark';
			}

			button.classList.toggle(
				'is-waiting',
				starting && !playing
			);

			if (label) {
				label.textContent =
					starting && !playing
						? 'loading…'
						: (playing
							? 'playing'
							: 'play');
			}
		}

		['play', 'playing', 'pause', 'ended', 'error']
			.forEach((name) => {
				music.addEventListener(
					name,
					() => {
						if (
							name === 'playing' ||
							name === 'pause' ||
							name === 'error'
						) {
							starting = false;
						}

						logAudio(
							'music ' + name
						);

						paintButton();
					}
				);
			});

		button.addEventListener(
			'click',
			() => {
				if (music.paused) {
					starting = true;

					paintButton();

					let played;

					try {
						played = music.play();
					} catch (error) {
						starting = false;

						logAudio(
							'music threw',
							describeError(error)
						);

						paintButton();

						return;
					}

					if (
						played &&
						typeof played.catch ===
							'function'
					) {
						played.catch((error) => {
							starting = false;

							logAudio(
								'music blocked',
								describeError(error)
							);

							paintButton();
						});
					}
				} else {
					music.pause();
				}
			}
		);

		paintButton();
	}

	initDate();
	initShuffle();
	initPolaroids();
	initDrawOn();
	initFlight();
	initSocials();
	initAudio();
})();
