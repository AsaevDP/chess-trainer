/* Шахматный тренажёр.
 * Данные — из data.js (window.DATA), их собирает scripts/04_build_trainer.py.
 * Прогресс хранится в браузере (localStorage), отдельно для каждого браузера.
 */
(function () {
  "use strict";
  const D = window.DATA;
  const $ = (id) => document.getElementById(id);

  // ---------- прогресс ----------
  const STORE_KEY = "chessprep.v1";
  let P = load();
  // Разово: прогресс «Дебюта» из версии без обучения со стрелками начинаем заново (задачи не трогаем)
  if (!P.v2) { P.cards = {}; P.v2 = true; save(); }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || fresh(); } catch (e) { return fresh(); }
  }
  function fresh() { return { puzzles: {}, cards: {}, solved: 0, firstTry: 0, streak: 0, best: 0, v2: true }; }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(P)); } catch (e) { /* приватный режим */ } }

  // Интервальное повторение: коробка 0..5, чем выше — тем реже показываем
  const MIN = 60e3, DAY = 864e5;
  const INTERVALS = [0, 10 * MIN, DAY, 3 * DAY, 7 * DAY, 21 * DAY];
  function grade(rec, ok) {
    rec.box = ok ? Math.min((rec.box || 0) + 1, 5) : 0;
    rec.due = Date.now() + INTERVALS[rec.box];
    return rec;
  }
  const isDue = (rec) => !rec || (rec.due || 0) <= Date.now();

  // ---------- доска ----------
  let chess = new Chess();
  let onUserMove = null;  // что делать, когда пользователь сходил
  const cg = Chessground($("board"), {
    coordinates: true,
    animation: { duration: 220 },
    highlight: { lastMove: true, check: true },
    movable: { free: false, showDests: true },
    draggable: { showGhost: true },
    events: { move: (orig, dest) => userMoved(orig, dest) },
  });
  Arrows.attach(cg, $("board"));  // свои стрелки в стиле Chess.com (trainer/arrows.js)

  function color(c) { return c === "w" ? "white" : "black"; }
  function dests() {
    const d = {};
    chess.moves({ verbose: true }).forEach((m) => { (d[m.from] = d[m.from] || []).push(m.to); });
    return d;
  }
  // Показать позицию; если myColor совпадает с очередью хода — даём ходить
  function show(fen, opts) {
    opts = opts || {};
    chess.load(fen);
    const turn = color(chess.turn());
    const canMove = opts.myColor === turn;
    cg.set({
      fen: fen,
      orientation: opts.orientation || cg.state.orientation,
      turnColor: turn,
      lastMove: opts.lastMove,
      check: chess.in_check() ? turn : false,
      movable: { color: canMove ? turn : undefined, dests: canMove ? dests() : {} },
    });
    cg.setShapes([]);                       // стрелки, нарисованные мышкой, — убираем при новой позиции
    cg.setAutoShapes(opts.shapes || []);    // стрелки-подсказки программы
  }
  function lock() { cg.set({ movable: { color: undefined, dests: {} } }); }
  // Сыграть ход за «соперника» с анимацией
  let programMove = null;  // доска сообщает и о ходах программы — их не считаем ходом игрока
  function playMove(uci) {
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
    programMove = uci.slice(0, 4);
    cg.move(uci.slice(0, 2), uci.slice(2, 4));
    cg.set({ fen: chess.fen(), turnColor: color(chess.turn()), check: chess.in_check() ? color(chess.turn()) : false });
    return m;
  }
  function userMoved(orig, dest) {
    if (programMove === orig + dest) { programMove = null; return; }
    const before = chess.fen();
    const m = chess.move({ from: orig, to: dest, promotion: "q" });
    if (!m) { show(before, { myColor: color(chess.turn()) }); return; }
    const uci = orig + dest + (m.promotion || "");
    cg.set({ fen: chess.fen(), turnColor: color(chess.turn()) });
    if (onUserMove) onUserMove(uci, m.san, before);
  }
  // Откатить неверный ход
  function undoTo(fen, myColor, shapes) {
    setTimeout(() => show(fen, { myColor: myColor, shapes: shapes }), 450);
  }
  function arrow(uci, brush) { return [{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: brush || "green" }]; }
  function status(text, cls) { const s = $("status"); s.textContent = text || ""; s.className = "status " + (cls || ""); }

  function lineText(sans, startPly) {
    startPly = startPly || 0;
    return sans.map((s, i) => {
      const ply = i + startPly;
      if (ply % 2 === 0) return (ply / 2 + 1) + "." + s;
      return i === 0 ? Math.floor(ply / 2) + 1 + "..." + s : s;
    }).join(" ");
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (v) => (v > 0 ? "+" : "") + v.toFixed(1);

  // ---------- стрелки-подсказки (переключатель в шапке, запоминается) ----------
  const HINTS_KEY = "chessprep.hints";
  let hintsOn = false;
  try { hintsOn = localStorage.getItem(HINTS_KEY) === "1"; } catch (e) { /* нет хранилища */ }
  $("hints").checked = hintsOn;
  $("hints").addEventListener("change", () => {
    hintsOn = $("hints").checked;
    try { localStorage.setItem(HINTS_KEY, hintsOn ? "1" : "0"); } catch (e) { /* нет хранилища */ }
    // перерисовать подсказку в текущем режиме
    if (mode === "puzzles") Puzzles.applyHint();
    if (mode === "opening") Opening.applyHint();
    if (mode === "spar" && window.Spar) window.Spar.applyHint();
  });
  const HINT_BRUSH = "blue";

  // ---------- режимы ----------
  let mode = "puzzles";
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  function setMode(m) {
    mode = m;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    document.querySelectorAll(".mode").forEach((el) => (el.hidden = el.id !== "mode-" + m));
    status("");
    onUserMove = null;
    if (window.Spar) window.Spar.stop();  // бот не должен ходить на чужой вкладке
    if (m === "puzzles") Puzzles.next();
    if (m === "opening") Opening.next();
    if (m === "spar") window.Spar.start();
  }

  // ================= ЗАДАЧИ =================
  const Puzzles = (function () {
    let cur = null, tries = 0, done = false, ready = false, run = 0;

    function queue() {
      const f = $("pz-filter").value;
      let list = D.puzzles.slice();
      if (f === "only") list = list.filter((p) => p.vs_me > 0);
      if (f === "all") list.sort((a, b) => b.count - a.count);
      // сначала те, что пора повторить (ошибался раньше), потом новые
      const due = list.filter((p) => P.puzzles[p.id] && isDue(P.puzzles[p.id]) && P.puzzles[p.id].box < 5);
      const fresh = list.filter((p) => !P.puzzles[p.id]);
      return due.concat(fresh);
    }

    function next() {
      const q = queue();
      if (!D.puzzles.length) {
        cur = null;
        $("pz-info").innerHTML = "<div class='big'>Задачи ещё не готовы</div><div class='meta'>Stockfish ищет ошибки брата — появятся после следующего обновления.</div>";
        show(new Chess().fen(), {}); lock(); stats(); return;
      }
      if (!q.length) {
        cur = null;
        $("pz-info").innerHTML = "<div class='big'>Всё решено 🎉</div><div class='meta'>Новых задач нет, ошибки повторятся, когда подойдёт время.</div>";
        show(new Chess().fen(), {}); lock(); stats(); return;
      }
      // чтобы не было скучно — немного случайности среди первых пяти
      cur = q[Math.floor(Math.random() * Math.min(5, q.length))];
      tries = 0; done = false; ready = false;
      const my = ++run;  // если за 0.7 с открыли другую задачу — этот таймер ничего не делает
      const me = cur.brother_color === "white" ? "black" : "white";
      const prevLine = cur.line.slice(0, -1);
      const no = cur.move_no + (cur.brother_color === "white" ? "." : "...");
      $("pz-info").innerHTML =
        "<div class='line'>" + esc(lineText(prevLine) || "Начальная позиция") + "</div>" +
        "<div class='big'>Брат сыграл " + esc(no + cur.his_move) + "?</div>" +
        "<div>Ты играешь " + (me === "white" ? "белыми" : "чёрными") + ". Найди лучший ответ.</div>" +
        "<div class='meta'>Встречалось " + cur.count + " раз" +
        (cur.vs_me ? " (против тебя — " + cur.vs_me + ")" : "") +
        " · соперники наказали " + cur.punished + " из " + cur.count + "</div>";
      status("");
      // сначала позиция ДО его хода, потом анимируем его ошибку
      show(cur.prev_fen, { orientation: me });
      lock();
      setTimeout(() => {
        if (my !== run || mode !== "puzzles") return;
        playMove(cur.his_uci);
        show(cur.fen, { myColor: me, lastMove: [cur.his_uci.slice(0, 2), cur.his_uci.slice(2, 4)] });
        status("Твой ход");
        ready = true;
        applyHint();
      }, 700);
      onUserMove = answer;
      stats();
    }

    function answer(uci, san) {
      if (!cur || done) return;
      const me = cur.brother_color === "white" ? "black" : "white";
      tries++;
      if (cur.accept.indexOf(uci) >= 0) {
        done = true; lock();
        const first = tries === 1;
        P.solved++;
        if (first) { P.firstTry++; P.streak++; P.best = Math.max(P.best, P.streak); }
        else P.streak = 0;
        P.puzzles[cur.id] = grade(P.puzzles[cur.id] || {}, first);
        save();
        const best = uci === cur.best_uci ? "" : " (Stockfish предпочитает " + cur.best_san + ")";
        status((first ? "Верно! " : "Решено. ") + san + best, "good");
        $("pz-info").insertAdjacentHTML("beforeend", explain());
        cg.setAutoShapes(arrow(cur.best_uci));
        stats();
      } else {
        status("Не то: " + san + ". Попробуй ещё", "bad");
        if (tries >= 2) reveal(false);
        else { undoTo(cur.fen, me, hintsOn ? arrow(cur.best_uci, HINT_BRUSH) : []); }
      }
    }

    function explain() {
      return "<div class='meta' style='margin-top:8px'>Оценка для брата: " + fmt(cur.eval_before) + " → " +
        fmt(cur.eval_after) + "<br>Лучшее продолжение: <b>" + esc(lineText(cur.pv, cur.line.length)) + "</b>" +
        (cur.links.length ? "<br>Партия: <a href='" + esc(cur.links[0]) + "' target='_blank'>открыть на Chess.com</a>" : "") + "</div>";
    }

    function reveal() {
      if (!cur || done) return;
      done = true;
      const me = cur.brother_color === "white" ? "black" : "white";
      P.streak = 0;
      P.puzzles[cur.id] = grade(P.puzzles[cur.id] || {}, false);  // вернётся через 10 минут
      save();
      show(cur.fen, { shapes: arrow(cur.best_uci), lastMove: [cur.his_uci.slice(0, 2), cur.his_uci.slice(2, 4)] });
      lock();
      status("Ответ: " + cur.best_san + ". Задача вернётся позже", "warn");
      $("pz-info").insertAdjacentHTML("beforeend", explain());
      stats();
    }

    function hint() {
      if (!cur || done) return;
      tries = Math.max(tries, 1);  // с подсказкой — уже не «с первой попытки»
      cg.setAutoShapes([{ orig: cur.best_uci.slice(0, 2), brush: "yellow" }]);
      status("Подсказка: ходит эта фигура", "warn");
    }

    // Стрелка-подсказка: с ней задача уже не «с первой попытки»
    function applyHint() {
      if (!cur || done || !ready) return;
      if (hintsOn) { tries = Math.max(tries, 1); cg.setAutoShapes(arrow(cur.best_uci, HINT_BRUSH)); }
      else cg.setAutoShapes([]);
    }

    function stats() {
      const total = D.puzzles.length;
      const learned = Object.values(P.puzzles).filter((r) => r.box >= 1).length;
      const pct = P.solved ? Math.round(100 * P.firstTry / P.solved) : 0;
      $("pz-stats").innerHTML = "Задач: <b>" + total + "</b> · решено хоть раз: <b>" + learned + "</b> · с первой попытки: <b>" + pct +
        "%</b> · серия: <b>" + P.streak + "</b> (рекорд " + P.best + ")<div class='bar'><i style='width:" +
        (total ? 100 * learned / total : 0) + "%'></i></div>";
    }

    $("pz-next").addEventListener("click", next);
    $("pz-show").addEventListener("click", reveal);
    $("pz-hint").addEventListener("click", hint);
    $("pz-filter").addEventListener("change", next);
    return { next: next, applyHint: applyHint };
  })();

  // ================= ДЕБЮТ =================
  // Обучение в два шага, как на Chessable:
  //   1) новый ход — показываем стрелкой и объясняем, ты просто повторяешь;
  //   2) потом (через 10 мин, день, 3 дня...) — без стрелки, вспоминаешь сам.
  //   Ошибся при повторении — ход снова становится «новым» и в следующий раз будет со стрелкой.
  const Opening = (function () {
    let line = null, idx = 0, myColor = "black", mistakes = 0, startFen = new Chess().fen(), run = 0;
    let checkMode = false;           // «Проверить себя»: та же линия сразу без стрелок
    const marks = [];
    const hinted = new Set();        // ходы со стрелкой от переключателя «Стрелки» (не засчитываются)
    const learning = new Set();      // ходы, которые в этом проходе учили по стрелке

    function rep() { return D.rep[$("op-color").value]; }
    const rec = (id) => P.cards[id];
    const isNew = (r) => !r || r.learn || !r.box;      // ещё не выучен (или забыт после ошибки)
    const isReview = (r) => r && !r.learn && isDue(r); // пора вспомнить по памяти

    // Сначала повторяем то, что пора вспомнить (и забытое), потом — новая линия
    function pick() {
      const lines = rep().lines;
      const count = (l, f) => l.filter((p) => p.me && f(rec(p.card))).length;
      const best = (score) => {
        let top = 0, cands = [];
        lines.forEach((l) => { const s = score(l); if (s > top) { top = s; cands = [l]; } else if (s === top && s > 0) cands.push(l); });
        return top > 0 ? cands[Math.floor(Math.random() * cands.length)] : null;
      };
      let l = best((x) => count(x, isReview) + count(x, (r) => r && r.learn));
      if (l) return { line: l, kind: "review" };
      l = best((x) => count(x, (r) => !r));
      if (l) return { line: l, kind: "learn" };
      return { line: lines[Math.floor(Math.random() * lines.length)], kind: "extra" };
    }

    function next() {
      myColor = rep().color || $("op-color").value;
      if (!rep().lines.length) { $("op-info").textContent = "Репертуар пуст — пересобери тренажёр."; return; }
      const p = pick();
      line = p.line;
      checkMode = false;
      $("op-info").innerHTML = {
        review: "<div class='meta'>🔁 Повторение: вспоминай ходы по памяти.</div>",
        learn: "<div class='meta'>📘 Новая линия: ходы показаны стрелкой — запоминай.</div>",
        extra: "<div class='meta'>Всё выучено и повторено на сегодня — гоняем для закрепления.</div>",
      }[p.kind];
      restart();
    }

    function restart() {
      idx = 0; mistakes = 0; marks.length = 0; hinted.clear(); learning.clear();
      run++;  // отменяем отложенные ходы соперника из прошлой линии
      $("op-check").hidden = true;
      why("");
      show(startFen, { orientation: myColor });
      lock();
      onUserMove = answer;
      status("");
      step();
    }

    function why(html) { const w = $("op-why"); w.hidden = !html; w.innerHTML = html || ""; }
    function card(id) { return rep().cards.find((c) => c.id === id); }

    // Проигрываем ходы соперника, пока не дойдём до твоего хода
    function step() {
      render();
      if (idx >= line.length) { finish(); return; }
      const ply = line[idx];
      if (ply.me) {
        show(chess.fen(), { myColor: myColor, lastMove: cg.state.lastMove });
        if (!checkMode && isNew(rec(ply.card))) {
          learning.add(idx);
          cg.setAutoShapes(arrow(ply.uci, "green"));
          const c = card(ply.card);
          why("<div class='tag'>📘 Новый ход — запомни</div><b>" + esc(lineText([ply.san], idx)) + "</b> — " + esc(c ? c.why : ""));
          status("Сыграй ход по стрелке");
        } else {
          status(checkMode ? "Проверка: вспомни ход сам" : "Твой ход — вспомни по памяти");
          applyHint();
        }
        return;
      }
      const my = run;
      setTimeout(() => {
        if (my !== run || mode !== "opening") return;
        playMove(ply.uci);
        marks[idx] = "";
        $("op-info").innerHTML = "<div>Соперник: <b>" + esc(lineText([ply.san], idx)) + "</b></div><div class='meta'>" +
          (ply.n ? "Так отвечают в " + ply.share + "% партий в этой позиции (" + ply.n + " раз" + (ply.n_bro ? ", из них брат — " + ply.n_bro : "") + ")"
                 : "В ваших партиях такой позиции почти не было — сильнейший ответ по Stockfish") + "</div>";
        idx++;
        step();
      }, 550);
    }

    function answer(uci, san, beforeFen) {
      const ply = line[idx];
      if (!ply || !ply.me) return;
      const c = card(ply.card);
      const explain = "<b>" + esc(lineText([ply.san], idx)) + "</b> — " + esc(c ? c.why : "");
      if (uci === ply.uci) {
        if (learning.has(idx)) {
          // выучил по стрелке → первое повторение через 10 минут, уже без стрелки
          P.cards[ply.card] = { box: 1, due: Date.now() + INTERVALS[1], learn: false };
          status("Запомнили " + san + ". Без стрелки повторим через 10 минут", "good");
        } else {
          const helped = hinted.has(idx);
          // продвигаем, только если пора было повторять (досрочный ответ интервал не растит)
          if (!checkMode && marks[idx] !== "err" && !helped && isDue(rec(ply.card))) P.cards[ply.card] = grade(rec(ply.card) || {}, true);
          status("Верно: " + san + (helped ? " (со стрелкой — в выученные не засчитано)" : ""), "good");
          why("<div class='tag ok'>✔ Правильно</div>" + explain);
        }
        marks[idx] = marks[idx] || "ok";
        save();
        lock();
        idx++;
        step();
      } else if (learning.has(idx)) {
        status("Сыграй ход по стрелке: " + ply.san, "warn");
        undoTo(beforeFen, myColor, arrow(ply.uci, "green"));
      } else {
        mistakes++;
        marks[idx] = "err";
        // забыл → ход снова «новый»: в следующий раз будет со стрелкой
        P.cards[ply.card] = { box: 0, due: Date.now(), learn: true };
        save();
        status("Не так. Здесь играем " + ply.san, "bad");
        why("<div class='tag bad'>✘ Запомни</div>" + explain);
        undoTo(beforeFen, myColor, arrow(ply.uci, "green"));
      }
      render();
    }

    // Стрелка от переключателя «Стрелки» (при повторении)
    function applyHint() {
      if (!line || idx >= line.length || !line[idx].me || learning.has(idx)) return;
      if (hintsOn) { hinted.add(idx); cg.setAutoShapes(arrow(line[idx].uci, HINT_BRUSH)); }
      else cg.setAutoShapes([]);
    }

    function finish() {
      lock();
      if (learning.size && !checkMode) {
        status("Линия изучена! Теперь проверь себя без стрелок", "good");
        $("op-check").hidden = false;
      } else if (checkMode) {
        status(mistakes ? "Проверка: ошибок " + mistakes + " — эти ходы снова будут со стрелкой" : "Проверка пройдена без ошибок ✓", mistakes ? "warn" : "good");
      } else {
        status(mistakes ? "Линия пройдена, ошибок: " + mistakes + ". Эти ходы вернутся со стрелкой" : "Линия пройдена без ошибок ✓", mistakes ? "warn" : "good");
      }
    }

    function render() {
      const html = line.map((p, i) => {
        const cls = [p.me ? "me" : "", marks[i] || "", i === idx ? "cur" : ""].join(" ");
        const shown = i < idx || marks[i] === "err";
        const num = i % 2 === 0 ? (i / 2 + 1) + "." : (i === 0 ? "1..." : "");
        const txt = num + (shown ? p.san : "…");
        return "<span class='" + cls + "'>" + esc(txt) + "</span>";
      }).join(" ");
      $("op-moves").innerHTML = html;
      const cards = rep().cards;
      const st = cards.map((c) => rec(c.id));
      const fresh = st.filter((r) => !r).length;
      const learned = st.filter((r) => r && !r.learn && r.box >= 3).length;
      const studying = cards.length - fresh - learned;
      const dueN = st.filter((r) => isReview(r) || (r && r.learn)).length;
      $("op-stats").innerHTML = "Ходов в репертуаре: <b>" + cards.length + "</b> · новых: <b>" + fresh +
        "</b> · учу: <b>" + studying + "</b> · выучено: <b>" + learned + "</b> · повторить сейчас: <b>" + dueN + "</b>" +
        "<div class='bar'><i style='width:" + (cards.length ? 100 * learned / cards.length : 0) + "%'></i></div>";
    }

    // «Проверить себя»: та же линия сразу, без стрелок; ошибки возвращают ходы в изучение
    function check() {
      if (!line) return;
      checkMode = true;
      restart();
    }

    $("op-next").addEventListener("click", next);
    $("op-restart").addEventListener("click", () => { if (line) { checkMode = false; restart(); } });
    $("op-check").addEventListener("click", check);
    $("op-color").addEventListener("change", next);
    return { next: next, applyHint: applyHint };
  })();

  // ---------- общее ----------
  $("gen").textContent = "Данные от " + D.generated + " · задач " + D.puzzles.length;
  // ---------- обновление через локальный сервер (scripts/server.py) ----------
  const viaServer = location.protocol.indexOf("http") === 0;
  let wasRunning = false;
  function banner(html, cls) {
    const b = $("banner");
    b.hidden = !html; b.innerHTML = html || ""; b.className = "banner " + (cls || "");
  }
  async function poll() {
    let s;
    try { s = await (await fetch("api/status")).json(); } catch (e) { return; }
    if (s.running) {
      wasRunning = true;
      banner("⏳ Обновление: шаг " + s.step + " из " + s.total + " — " + esc(s.title) + "…<div class='meta'>" + esc(s.line) + "</div>");
      setTimeout(poll, 1500);
    } else if (s.error) {
      banner("Обновление не удалось: " + esc(s.error), "bad");
    } else if (wasRunning) {
      banner("✅ Обновлено — загружаю свежие данные…");
      setTimeout(() => location.reload(), 800);
    }
  }
  if (D.public) {
    // на сайте нет локального сервера — кнопки «Обновить» нет
  } else if (viaServer) {
    $("update").addEventListener("click", async () => {
      try { await fetch("api/update", { method: "POST" }); } catch (e) { banner("Сервер не отвечает — запусти тренажёр ярлыком", "bad"); return; }
      poll();
    });
    poll();  // вдруг уже идёт автообновление при запуске
    setInterval(() => fetch("api/ping").catch(() => {}), 60e3);  // «тренажёр открыт» — сервер не выключается
  } else {
    $("update").hidden = true;
    banner("Открыто как файл: бот-спарринг и кнопка «Обновить» работают, только если запускать ярлыком «Тренажёр против брата».");
  }
  $("reset").addEventListener("click", () => {
    if (confirm("Стереть весь прогресс тренировок?")) { P = fresh(); save(); setMode(mode); }
  });

  // Для спарринга (шаг 5) — отдаём наружу инструменты доски
  window.Trainer = { show, lock, playMove, status, setOnUserMove: (f) => (onUserMove = f), cg, chess: () => chess, arrow, hints: () => hintsOn };

  // в списке «Я играю» оставляем только репертуары, которые есть в данных
  [...$("op-color").options].forEach((o) => { if (!D.rep[o.value]) o.remove(); });

  // Публичная версия (сайт): только дебюты и спарринг со Stockfish
  if (D.public) {
    document.title = "Шахматный тренажёр";
    document.querySelector("header h1").textContent = "Шахматный тренажёр";
    document.querySelector('[data-mode="puzzles"]').hidden = true;
    document.querySelector('a[href="dossier.html"]').hidden = true;
    $("update").hidden = true;
    $("banner").hidden = true;
    $("gen").textContent = "Обновлено " + D.generated;
    if (D.rep.london_white) $("op-color").value = "london_white";  // первым — Лондон
    setMode("opening");
  } else {
    setMode("puzzles");
  }
})();
