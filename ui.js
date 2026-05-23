'use strict';

// ── Game state ─────────────────────────────────────────────────────────────────
let G = null;
let showAll = false;

function isHandVisible(p) {
  if (showAll) return true;
  if (p === 2) return true; // South always visible
  if (G.phase === 'playing' && p === G.dummy) return true; // dummy face-up
  return false;
}

function newGame() {
  const hands = deal();
  G = {
    phase: 'bidding',
    hands,
    originalHands: hands.map(h => [...h]),
    dealer: 0,
    auction: [],
    contract: null,
    dummy: -1,
    leader: -1,
    curPlayer: 0,
    curTrick: [],
    tricks: [],
    tricksNS: 0,
    tricksEW: 0,
    vulnerable: [false, false],
    baseScoresNS: G ? G.scoresNS : 0,
    baseScoresEW: G ? G.scoresEW : 0,
    scoresNS: G ? G.scoresNS : 0,
    scoresEW: G ? G.scoresEW : 0,
    passCount: 0,
    msg: '',
  };
  render();
  setTimeout(advanceBid, 400);
}

// ── Bidding flow ───────────────────────────────────────────────────────────────
function advanceBid() {
  if (G.phase !== 'bidding') return;
  if (G.curPlayer === 2) { render(); return; }
  const bid = aiBid(G, G.curPlayer);
  applyBid(G.curPlayer, bid);
}

function applyBid(player, bid) {
  G.auction.push({player, bid});
  G.passCount = bid.pass ? G.passCount+1 : 0;

  const high = highestBid(G.auction);
  const done = (!high && G.passCount===4) || (high && G.passCount===3);

  if (done) { endAuction(high); return; }

  G.curPlayer = (G.curPlayer+1)%4;
  render();
  setTimeout(advanceBid, 700);
}

function endAuction(high) {
  if (!high) {
    G.msg = 'All pass — redealing...';
    render();
    setTimeout(newGame, 1800);
    return;
  }
  const side     = G.auction.find(x=>!x.bid.pass && x.bid.suit===high.suit && x.bid.level===high.level)?.player % 2 ?? 0;
  const declarer = findDeclarer(G.auction, high.suit, side);
  G.contract     = {level:high.level, suit:high.suit, declarer};
  G.dummy        = (declarer+2)%4;
  G.leader       = (declarer+1)%4;
  G.curPlayer    = G.leader;
  G.phase        = 'playing';
  G.msg          = '';
  render();
  setTimeout(advancePlay, 900);
}

// ── Card play flow ─────────────────────────────────────────────────────────────
function advancePlay() {
  if (G.phase !== 'playing') return;
  const p = G.curPlayer;
  const isNSContract = G.contract.declarer % 2 === 0;
  const humanTurn = p===2 || (isNSContract && p===0);
  if (humanTurn) { render(); return; }
  const c = aiPlay(G, p);
  applyPlay(p, c);
}

function applyPlay(player, card) {
  G.hands[player] = G.hands[player].filter(c=>c!==card);
  G.curTrick.push({player, card});

  if (G.curTrick.length === 4) {
    G.curPlayer = -1; // block clicks during pause
    render();
    setTimeout(() => {
      const trump = G.contract.suit<4 ? G.contract.suit : -1;
      const win   = trickWinner(G.curTrick, trump);
      G.tricks.push({winner:win, cards:G.curTrick});
      if (win%2===0) G.tricksNS++; else G.tricksEW++;
      G.curTrick  = [];
      G.curPlayer = win;
      if (G.tricks.length === 13) { endGame(); return; }
      render();
      setTimeout(advancePlay, 400);
    }, 1200);
  } else {
    G.curPlayer = (G.curPlayer+1)%4;
    render();
    setTimeout(advancePlay, 600);
  }
}

function endGame() {
  const {level, suit, declarer} = G.contract;
  const isNS   = declarer%2===0;
  const made   = isNS ? G.tricksNS : G.tricksEW;
  const pts    = scoreContract(G.contract, made, G.vulnerable);
  G.scoresNS  += pts > 0 ? pts : 0;
  G.scoresEW  += pts < 0 ? -pts : 0;
  G.phase      = 'done';

  const need   = level+6;
  const sStr   = suit===4?'NT':SYM[suit];
  const declN  = PNAME[declarer];
  if (made >= need) {
    const over = made-need;
    showMessage(
      `Contract Made!`,
      `${level}${sStr} by ${declN} — made ${made} tricks${over?` (+${over} overtrick${over>1?'s':''})`:''}\n+${Math.abs(pts)} points to ${isNS?'NS':'EW'}`
    );
  } else {
    showMessage(
      `Down ${need-made}`,
      `${level}${sStr} by ${declN} — only ${made} tricks needed ${need}\n${Math.abs(pts)} points to ${isNS?'EW':'NS'}`
    );
  }
  render();
}

// ── Rendering ──────────────────────────────────────────────────────────────────
function render() {
  renderHands();
  renderTrick();
  renderAuction();
  renderStatus();
  updateScores();
}

const HAND_IDS = ['north','east','south','west'];

function renderHands() {
  for (let p=0;p<4;p++) {
    const el = document.getElementById(HAND_IDS[p]+'-hand');
    el.innerHTML = '';
    if (!G.hands[p]) continue;
    const visible = isHandVisible(p);
    for (const c of G.hands[p]) {
      const d = document.createElement('div');
      if (!visible) {
        d.className = 'card back';
        el.appendChild(d);
        continue;
      }
      d.className = 'card';
      d.style.color = SCOL[c.suit];
      d.textContent = cstr(c);

      const isNSContract = G.contract?.declarer % 2 === 0;
      const isDummy = G.phase==='playing' && p===G.dummy;
      const isHumanCard = G.phase==='playing' && G.curPlayer===p && (p===2 || (isNSContract && p===0));

      if (isHumanCard) {
        d.classList.add('playable');
        if (isDummy) d.classList.add('dummy-card');
        const cc = c;
        d.addEventListener('click', () => onCardClick(p, cc));
      }
      if (isDummy) d.style.outline='1px solid rgba(200,255,200,0.3)';
      el.appendChild(d);
    }
    const hcpEl = document.getElementById(['n','e','s','w'][p]+'-hcp');
    if (hcpEl) hcpEl.textContent = visible && G.hands[p] ? hHCP(G.hands[p])+'p' : '';
  }
}

function renderTrick() {
  const slots = ['n','e','s','w'];
  for (const sl of slots) document.getElementById('trick-'+sl).innerHTML='';

  for (const {player, card: c} of G.curTrick) {
    const sl = document.getElementById('trick-'+slots[player]);
    const d  = document.createElement('div');
    d.className = 'card';
    d.style.color = SCOL[c.suit];
    d.textContent = cstr(c);
    sl.appendChild(d);
  }

  const tc = document.getElementById('trick-count');
  if (G.phase==='playing'||G.phase==='done') {
    tc.textContent = `NS ${G.tricksNS} – ${G.tricksEW} EW`;
  } else {
    tc.textContent = '';
  }
}

function renderAuction() {
  const el = document.getElementById('auction-table');
  if (G.phase !== 'bidding') { el.innerHTML=''; return; }

  let html = '<table><tr><th>N</th><th>E</th><th>S</th><th>W</th></tr><tr>';
  let col = G.dealer;
  for(let i=0;i<col;i++) html+='<td></td>';

  for(const {player, bid} of G.auction) {
    html += `<td>${fmtBid(bid)}</td>`;
    if (player===3) html+='</tr><tr>';
  }
  html += '</tr></table>';
  el.innerHTML = html;
  renderBidBox();
}

function fmtBid(b) {
  if (b.pass) return '<span style="color:#aaa">Pass</span>';
  const s = b.suit===4?'NT':`<span style="color:${SCOL[b.suit]}">${SYM[b.suit]}</span>`;
  return `<b>${b.level}${s}</b>`;
}

function renderBidBox() {
  const el = document.getElementById('bid-box');
  if (G.phase!=='bidding'||G.curPlayer!==2) { el.style.display='none'; return; }
  const high = highestBid(G.auction);
  let html = '<div class="bid-grid">';
  const scls = ['club','diamond','heart','spade','nt'];
  for(let lv=1;lv<=7;lv++) {
    for(let su=0;su<=4;su++) {
      const b   = mkBid(lv,su);
      const dis = !beats(b,high);
      const sym = su===4?'NT':`<span style="color:${SCOL[su]}">${SYM[su]}</span>`;
      html += `<button class="bid-btn ${scls[su]}${dis?' disabled':''}"
        onclick="humanBid(${lv},${su})" ${dis?'disabled':''}>${lv}${sym}</button>`;
    }
  }
  html += '</div><div class="bid-actions"><button class="pass-btn" onclick="humanBid(-1,-1)">Pass</button></div>';
  el.innerHTML = html;
  el.style.display = 'block';
}

function renderStatus() {
  const el = document.getElementById('status-msg');
  const cd = document.getElementById('contract-display');
  if (G.msg) { el.textContent=G.msg; }
  else if (G.phase==='bidding') {
    el.textContent = G.curPlayer===2 ? 'Your bid (South):' : `${PNAME[G.curPlayer]} is bidding…`;
  } else if (G.phase==='playing') {
    const p = G.curPlayer;
    if (p === -1) { el.textContent = ''; }
    else {
      const isNSContract = G.contract.declarer % 2 === 0;
      const human = p===2 || (isNSContract && p===0);
      el.textContent = human ? 'Your turn — click a card' : `${PNAME[p]} is playing…`;
    }
  } else {
    el.textContent='';
  }

  if (G.contract && G.phase!=='bidding') {
    const {level,suit,declarer} = G.contract;
    const sStr = suit===4?'NT':`<span style="color:${SCOL[suit]}">${SYM[suit]}</span>`;
    const need = level+6;
    const made = declarer%2===0?G.tricksNS:G.tricksEW;
    cd.innerHTML = `Contract: <b>${level}${sStr}</b> by ${PNAME[declarer]} &nbsp;|&nbsp; Need ${need} tricks`;
  } else {
    cd.innerHTML='';
  }
}

function updateScores() {
  document.getElementById('ns-score').textContent = G.scoresNS;
  document.getElementById('ew-score').textContent = G.scoresEW;
}

// ── Event handlers ─────────────────────────────────────────────────────────────
function humanBid(level, suit) {
  if (G.phase!=='bidding'||G.curPlayer!==2) return;
  document.getElementById('bid-box').style.display='none';
  applyBid(2, level===-1 ? PASS() : mkBid(level,suit));
}

function onCardClick(player, card) {
  if (G.phase!=='playing') return;
  const trick = G.curTrick;
  if (trick.length>0) {
    const led  = trick[0].card.suit;
    const have = G.hands[player].some(c=>c.suit===led);
    if (have && card.suit!==led) {
      G.msg='Must follow suit!';
      render();
      setTimeout(()=>{G.msg='';render();},1200);
      return;
    }
  }
  applyPlay(player, card);
}

function showMessage(title, body) {
  document.getElementById('msg-title').textContent = title;
  document.getElementById('msg-body').textContent  = body;
  document.getElementById('message-overlay').style.display='block';
}

function replayHand() {
  document.getElementById('message-overlay').style.display='none';
  G = {
    phase: 'bidding',
    hands: G.originalHands.map(h => [...h]),
    originalHands: G.originalHands,
    dealer: G.dealer,
    auction: [],
    contract: null,
    dummy: -1,
    leader: -1,
    curPlayer: G.dealer,
    curTrick: [],
    tricks: [],
    tricksNS: 0,
    tricksEW: 0,
    vulnerable: G.vulnerable,
    baseScoresNS: G.baseScoresNS,
    baseScoresEW: G.baseScoresEW,
    scoresNS: G.baseScoresNS,
    scoresEW: G.baseScoresEW,
    passCount: 0,
    msg: '',
  };
  render();
  setTimeout(advanceBid, 400);
}

function dismissMessage() {
  document.getElementById('message-overlay').style.display='none';
  newGame();
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.getElementById('new-game-btn').addEventListener('click', newGame);
document.getElementById('show-all-cb').addEventListener('change', e => { showAll = e.target.checked; render(); });
newGame();
