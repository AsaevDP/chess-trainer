/* Стрелки поверх доски в стиле Chess.com: толстые, полупрозрачные, у коня — буквой «Г».
 *   Arrows.attach(cg, boardEl)  — подключить к доске chessground
 *   cg.setAutoShapes([...])     — стрелки программы (подсказки), зелёные
 *   Правая кнопка мыши: протянуть — своя стрелка (оранжевая), клик — подсветить клетку.
 *   Левый клик по доске стирает свои стрелки.
 * Стрелки рисуем сами, потому что встроенные в эту версию chessground не отображаются.
 */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const COLORS = {
    green: "#2f9e44", blue: "#2f9e44",   // подсказки тренажёра — зелёные
    yellow: "#f2b01e", red: "#d9480f",
    user: "#f59f00",                      // свои стрелки — оранжевые, как на Chess.com
  };

  function attach(cg, boardEl) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("class", "arrows");
    boardEl.parentElement.appendChild(svg);

    let auto = [];        // стрелки программы
    let user = [];        // стрелки, нарисованные мышкой
    let userSquares = []; // подсвеченные клетки

    // клетка «e4» → центр клетки в координатах 0..8 (с учётом разворота доски)
    function xy(sq) {
      const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1;
      const white = cg.state.orientation === "white";
      return [(white ? f : 7 - f) + 0.5, (white ? 7 - r : r) + 0.5];
    }

    function arrowEl(orig, dest, color) {
      const [x1, y1] = xy(orig), [x2, y2] = xy(dest);
      const dx = x2 - x1, dy = y2 - y1;
      const pts = [[x1, y1]];
      // ход конём — рисуем «Г»: сначала длинная часть, потом поворот
      if (Math.abs(dx) && Math.abs(dy) && Math.abs(dx) + Math.abs(dy) === 3) {
        pts.push(Math.abs(dy) === 2 ? [x1, y2] : [x2, y1]);
      }
      const [px, py] = pts[pts.length - 1];
      const len = Math.hypot(x2 - px, y2 - py);
      const ux = (x2 - px) / len, uy = (y2 - py) / len;
      const tipX = x2 + ux * 0.18, tipY = y2 + uy * 0.18;     // остриё чуть за центром клетки
      const HEAD = 0.5, HALF = 0.33, WIDTH = 0.22;
      const bx = tipX - ux * HEAD, by = tipY - uy * HEAD;    // основание наконечника
      pts.push([bx, by]);
      const g = document.createElementNS(NS, "g");
      g.setAttribute("opacity", "0.82");
      const shaft = document.createElementNS(NS, "polyline");
      shaft.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
      shaft.setAttribute("fill", "none");
      shaft.setAttribute("stroke", color);
      shaft.setAttribute("stroke-width", WIDTH);
      shaft.setAttribute("stroke-linejoin", "miter");
      const head = document.createElementNS(NS, "polygon");
      const nx = -uy * HALF, ny = ux * HALF;
      head.setAttribute("points", [[tipX, tipY], [bx + nx, by + ny], [bx - nx, by - ny]].map((p) => p.join(",")).join(" "));
      head.setAttribute("fill", color);
      g.appendChild(shaft);
      g.appendChild(head);
      return g;
    }

    function squareEl(sq, color) {
      const [x, y] = xy(sq);
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", x - 0.5); r.setAttribute("y", y - 0.5);
      r.setAttribute("width", 1); r.setAttribute("height", 1);
      r.setAttribute("fill", color); r.setAttribute("opacity", "0.45");
      return r;
    }

    function render() {
      svg.textContent = "";
      userSquares.forEach((sq) => svg.appendChild(squareEl(sq, COLORS.red)));
      auto.forEach((s) => {
        const c = COLORS[s.brush] || COLORS.green;
        svg.appendChild(s.dest ? arrowEl(s.orig, s.dest, c) : squareEl(s.orig, c));
      });
      user.forEach((s) => svg.appendChild(arrowEl(s.orig, s.dest, COLORS.user)));
    }

    // Подменяем методы chessground: состояние храним там же (по нему работают проверки), рисуем сами
    cg.setAutoShapes = (shapes) => { auto = shapes || []; cg.state.drawable.autoShapes = auto; render(); };
    cg.setShapes = (shapes) => { user = (shapes || []).filter((s) => s.dest); userSquares = []; render(); };
    cg.state.drawable.enabled = false;  // встроенное рисование отключаем — у нас своё

    // ---- рисование правой кнопкой мыши ----
    function squareAt(e) {
      const b = boardEl.querySelector("cg-board").getBoundingClientRect();
      const fx = Math.floor(((e.clientX - b.left) / b.width) * 8), fy = Math.floor(((e.clientY - b.top) / b.height) * 8);
      if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
      const white = cg.state.orientation === "white";
      const file = white ? fx : 7 - fx, rank = white ? 7 - fy : fy;
      return String.fromCharCode(97 + file) + (rank + 1);
    }
    let from = null;
    boardEl.addEventListener("contextmenu", (e) => e.preventDefault());
    boardEl.addEventListener("mousedown", (e) => {
      if (e.button === 2) { from = squareAt(e); e.preventDefault(); }
      else if (e.button === 0 && (user.length || userSquares.length)) { user = []; userSquares = []; render(); }
    }, true);
    window.addEventListener("mouseup", (e) => {
      if (e.button !== 2 || !from) return;
      const to = squareAt(e);
      if (to && to !== from) {
        const i = user.findIndex((s) => s.orig === from && s.dest === to);
        if (i >= 0) user.splice(i, 1); else user.push({ orig: from, dest: to });
      } else if (to === from) {
        const i = userSquares.indexOf(from);
        if (i >= 0) userSquares.splice(i, 1); else userSquares.push(from);
      }
      from = null;
      render();
    });

    // при развороте доски перерисовать
    const origSet = cg.set.bind(cg);
    cg.set = (cfg) => { origSet(cfg); if (cfg && cfg.orientation) render(); };
  }

  window.Arrows = { attach: attach };
})();
