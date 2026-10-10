/* Спарринг с ботом.
 * 1) Если позиция есть в «книге» партий (data.js → book) — бот выбирает ход оттуда:
 *    случайно, пропорционально тому, как часто так ходили.
 * 2) Иначе — ослабленный Stockfish (libs/stockfish, работает в отдельном потоке браузера).
 */
(function () {
  "use strict";
  const D = window.DATA, T = window.Trainer;
  const $ = (id) => document.getElementById(id);
  const PUB = !!D.public;               // публичная версия (сайт): без книги партий, просто Stockfish
  const WHO = PUB ? "Соперник" : "Брат";

  // ---------- ослабленный Stockfish ----------
  // Уровни: глубина счёта, Skill Level движка и шанс «зевнуть» (сыграть случайный ход)
  const LEVELS = {
    700:  { depth: 3, skill: 0, blunder: 0.16, spread: 0.55 },
    900:  { depth: 4, skill: 0, blunder: 0.10, spread: 0.45 },
    1100: { depth: 6, skill: 2, blunder: 0.06, spread: 0.35 },
    1300: { depth: 8, skill: 5, blunder: 0.03, spread: 0.25 },
  };
  let engine = null, engineOk = true, pending = null, lines = {};
  function initEngine() {
    if (engine || !engineOk) return;
    try {
      engine = new Worker("libs/stockfish/stockfish.js");
    } catch (e) { engineOk = false; return; }
    engine.onmessage = (e) => {
      const line = typeof e.data === "string" ? e.data : "";
      // запоминаем лучший вариант для каждой из нескольких линий (MultiPV)
      const m = line.match(/ multipv (\d+) .*? pv (\S+)/);
      if (m && line.indexOf(" score ") > 0) {
        const sc = line.match(/score (cp|mate) (-?\d+)/);
        lines[m[1]] = { uci: m[2], cp: sc[1] === "mate" ? (sc[2] > 0 ? 10000 : -10000) : +sc[2] };
      }
      if (line.indexOf("bestmove") === 0 && pending) {
        const res = Object.keys(lines).sort((a, b) => a - b).map((k) => lines[k]);
        const p = pending; pending = null;
        p(res.length ? res : [{ uci: line.split(" ")[1], cp: 0 }]);
      }
    };
    engine.onerror = () => { engineOk = false; };
    engine.postMessage("uci");
    engine.postMessage("setoption name MultiPV value 4");
  }
  function engineMoves(fen, lvl) {
    return new Promise((resolve) => {
      lines = {};
      pending = resolve;
      engine.postMessage("setoption name Skill Level value " + lvl.skill);
      engine.postMessage("position fen " + fen);
      engine.postMessage("go depth " + lvl.depth);
      // страховка: если движок молчит — через 5 с случайный ход
      setTimeout(() => { if (pending === resolve) { pending = null; resolve([]); } }, 5000);
    });
  }

  // ---------- сильный Stockfish для стрелки-подсказки (отдельный, бот остаётся слабым) ----------
  let hinter = null, hintFen = null;
  function hintEngine() {
    if (hinter) return hinter;
    try { hinter = new Worker("libs/stockfish/stockfish.js"); } catch (e) { return null; }
    hinter.onmessage = (e) => {
      const line = typeof e.data === "string" ? e.data : "";
      if (line.indexOf("bestmove") !== 0) return;
      const uci = line.split(" ")[1];
      // рисуем, только если позиция не изменилась, пока движок думал
      if (game && hintFen === game.fen() && T.hints() && uci && uci !== "(none)") T.cg.setAutoShapes(T.arrow(uci, "blue"));
    };
    hinter.postMessage("uci");
    return hinter;
  }
  function applyHint() {
    if (!game || over || game.turn() !== myColor[0] || !T.hints()) { hintFen = null; T.cg.setAutoShapes([]); return; }
    const h = hintEngine();
    if (!h) return;
    hintFen = game.fen();
    h.postMessage("stop");
    h.postMessage("position fen " + hintFen);
    h.postMessage("go depth 14");
  }

  // ---------- книга брата ----------
  // Ключ позиции как в Python: без счётчиков ходов, взятие на проходе — только если оно реально возможно
  function bookKey(game) {
    const f = game.fen().split(" ");
    if (f[3] !== "-" && !game.moves({ verbose: true }).some((m) => m.flags.indexOf("e") >= 0)) f[3] = "-";
    return f.slice(0, 4).join(" ");
  }
  function bookMove(game) {
    const stats = D.book[bookKey(game)];
    if (!stats) return null;
    const opts = Object.keys(stats).map((san) => ({ san: san, n: stats[san][0], vs: stats[san][1], w: stats[san][0] + 2 * stats[san][1] }));
    const total = opts.reduce((s, o) => s + o.n, 0);
    let r = Math.random() * opts.reduce((s, o) => s + o.w, 0);
    for (const o of opts) {
      if ((r -= o.w) <= 0) return { san: o.san, n: o.n, vs: o.vs, share: Math.round(100 * o.n / total), total: total };
    }
    return null;
  }

  // ---------- партия ----------
  let game = null, myColor = "white", over = false, token = 0, log = [], bookStreak = 0, leftBookAt = null;

  function start() {
    token++;
    initEngine();
    const pick = $("sp-color").value;
    myColor = pick === "random" ? (Math.random() < 0.5 ? "white" : "black") : pick;
    game = new Chess();
    over = false; log = []; bookStreak = 0; leftBookAt = null;
    T.setOnUserMove(onMove);
    T.show(game.fen(), { orientation: myColor, myColor: myColor });
    $("sp-info").innerHTML = "Ты играешь <b>" + (myColor === "white" ? "белыми" : "чёрными") + "</b>. " +
      (PUB ? "Соперник — Stockfish ~" + $("sp-level").value + "." : "Брат-бот: ходит по партиям брата, а где их нет — Stockfish ~" + $("sp-level").value + ".");
    render();
    if (myColor === "white") { T.status("Твой ход"); applyHint(); }
    else botTurn();
  }

  function onMove(uci, san) {
    if (over || !game) return;
    game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
    log.push({ san: san, me: true });
    render();
    if (!checkEnd()) botTurn();
  }

  function botTurn() {
    const my = token;
    T.lock();
    hintFen = null;
    T.cg.setAutoShapes([]);
    T.status(WHO + " думает…");
    setTimeout(async () => {
      if (my !== token) return;
      let entry = null, uci = null;
      const b = bookMove(game);
      if (b) {
        const m = game.move(b.san);
        uci = m.from + m.to + (m.promotion || "");
        entry = { san: m.san, book: b };
        bookStreak++;
      } else {
        if (leftBookAt === null) leftBookAt = Math.floor(game.history().length / 2) + 1;
        uci = await engineChoice();
        if (my !== token) return;
        const m = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
        entry = { san: m.san, engine: true };
      }
      log.push(entry);
      T.show(game.fen(), { myColor: myColor, lastMove: [uci.slice(0, 2), uci.slice(2, 4)] });
      $("sp-info").innerHTML = entry.book
        ? "📖 <b>" + entry.san + "</b> — как брат: так он ходил в " + entry.book.share + "% случаев (" + entry.book.n + " из " + entry.book.total +
          (entry.book.vs ? ", против тебя " + entry.book.vs : "") + ")"
        : "🤖 <b>" + entry.san + "</b> — " + (PUB ? "" : "эту позицию брат не видел, ") + "ходит Stockfish ~" + $("sp-level").value;
      render();
      if (!checkEnd()) { T.status("Твой ход"); applyHint(); }
    }, 450 + Math.random() * 500);
  }

  async function engineChoice() {
    const legal = game.moves({ verbose: true });
    const rnd = () => { const m = legal[Math.floor(Math.random() * legal.length)]; return m.from + m.to + (m.promotion || ""); };
    const lvl = LEVELS[$("sp-level").value];
    if (!engine || !engineOk) return rnd();
    // иногда «зевает» — как живой игрок этого уровня
    if (Math.random() < lvl.blunder) return rnd();
    const cands = await engineMoves(game.fen(), lvl);
    if (!cands.length) return rnd();
    // чаще лучший ход, но с шансом взять 2–4-й из вариантов движка
    let i = 0;
    while (i < cands.length - 1 && Math.random() < lvl.spread) i++;
    return cands[i].uci;
  }

  function checkEnd() {
    if (!game.game_over()) return false;
    over = true;
    T.lock();
    let text;
    if (game.in_checkmate()) text = (game.turn() === myColor[0] ? "Мат. " + WHO + " выиграл" : "Мат! Ты выиграл 🎉");
    else if (game.in_stalemate()) text = "Пат — ничья";
    else if (game.in_threefold_repetition()) text = "Троекратное повторение — ничья";
    else text = "Ничья";
    T.status(text, game.in_checkmate() && game.turn() !== myColor[0] ? "good" : "warn");
    summary();
    return true;
  }

  function summary() {
    if (PUB) return;
    $("sp-info").insertAdjacentHTML("beforeend", "<div class='meta' style='margin-top:6px'>" +
      (leftBookAt ? "Бот играл как брат до " + leftBookAt + "-го хода, потом — Stockfish." : "Бот всю партию играл ходами брата.") + "</div>");
  }

  function undo() {
    if (!game || game.history().length === 0) return;
    token++;  // отменяем ход бота, если он сейчас думает
    over = false;
    // убираем последний ход, затем откатываем, пока снова не станет твой ход
    // (ответ бота + твой ход, или только твой ход, если бот ещё думал)
    game.undo(); log.pop();
    while (game.history().length && game.turn() !== myColor[0]) { game.undo(); log.pop(); }
    T.show(game.fen(), { myColor: myColor });
    T.status("Ход взят назад. Твой ход");
    applyHint();
    if (game.history().length === 0 && myColor === "black") botTurn();
    render();
  }

  function resign() {
    if (!game || over) return;
    over = true; token++;
    T.lock();
    T.status("Ты сдался. " + WHO + " выиграл", "bad");
    summary();
  }

  function render() {
    $("sp-moves").innerHTML = log.map((e, i) => {
      const no = i % 2 === 0 ? (i / 2 + 1) + "." : "";
      const mark = e.book ? " 📖" : e.engine ? " 🤖" : "";
      return "<span class='" + (e.me ? "me" : "") + "'>" + no + e.san + mark + "</span>";
    }).join(" ");
    const botMoves = log.filter((e) => !e.me).length;
    $("sp-stats").innerHTML = botMoves && !PUB ? "Ходов бота по партиям брата: <b>" + log.filter((e) => e.book).length + "</b> из " + botMoves : "";
  }

  function stop() { token++; }

  $("sp-new").addEventListener("click", start);
  $("sp-undo").addEventListener("click", undo);
  $("sp-resign").addEventListener("click", resign);
  $("sp-level").value = String(D.botElo in LEVELS ? D.botElo : 900);

  window.Spar = {
    start: () => (game && !over ? resume() : start()), stop: stop, bookMove: bookMove, bookKey: bookKey, applyHint: applyHint,
    // для проверки: работает ли движок и что он предлагает в позиции
    debug: async (fen) => { initEngine(); return { engineOk: engineOk, moves: engine ? await engineMoves(fen, LEVELS[900]) : [] }; },
  };

  // при возврате на вкладку — продолжаем ту же партию
  function resume() {
    T.setOnUserMove(onMove);
    T.show(game.fen(), { orientation: myColor, myColor: myColor });
    render();
    if (game.turn() !== myColor[0]) botTurn();
    else { T.status("Твой ход"); applyHint(); }
  }
})();
