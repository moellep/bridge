'use strict';

// -- Constants ------------------------------------------------------------------
const SYM   = ['♣','♦','♥','♠'];
const SNAME = ['Clubs','Diamonds','Hearts','Spades','NT'];
const SCOL  = ['#222','#c00','#c00','#222'];
const RNAME = ['','','2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const PNAME = ['North','East','South','West'];
// Player indices: N=0 E=1 S=2 W=3   Suits: ♣=0 ♦=1 ♥=2 ♠=3 NT=4

// -- Card utilities -------------------------------------------------------------
const card  = (rank, suit) => ({rank, suit});
const cstr  = c => RNAME[c.rank] + SYM[c.suit];
const hcp   = c => c.rank >= 11 ? c.rank - 10 : 0;
const hHCP  = h => h.reduce((s,c) => s + hcp(c), 0);
const sSuit = (h,s) => h.filter(c => c.suit === s);
const sLen  = (h,s) => sSuit(h,s).length;

function distPts(hand) {
  let p = 0;
  for (let s = 0; s < 4; s++) { const l = sLen(hand,s); if (l===0) p+=3; else if(l===1) p+=2; else if(l===2) p+=1; }
  return p;
}
const totPts = h => hHCP(h) + distPts(h);

function isBalanced(h) {
  const lens = [0,1,2,3].map(s=>sLen(h,s)).sort((a,b)=>a-b);
  return lens[0] >= 2;
}

// -- Deck -----------------------------------------------------------------------
function makeDeck() {
  const d = [];
  for (let s=0;s<4;s++) for(let r=2;r<=14;r++) d.push(card(r,s));
  return d;
}
function shuffle(a) {
  for(let i=a.length-1;i>0;i--){const j=0|Math.random()*(i+1);[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function deal() {
  const deck = shuffle(makeDeck());
  return [0,1,2,3].map(p => sortHand(deck.slice(p*13,(p+1)*13)));
}
function sortHand(h) {
  return [...h].sort((a,b) => a.suit!==b.suit ? b.suit-a.suit : b.rank-a.rank);
}

// -- Bid utilities --------------------------------------------------------------
// ROM encoding: bid_value = (level-1)*8 + suit  (♣=0 ♦=1 ♥=2 ♠=3 NT=4)
const bVal  = b => b.pass ? -1 : (b.level-1)*8 + b.suit;
const beats = (b, cur) => !cur || bVal(b) > bVal(cur);
const PASS  = () => ({pass:true});
const mkBid = (level,suit) => ({level,suit,pass:false});

function highestBid(auction) {
  for(let i=auction.length-1;i>=0;i--) {
    const b = auction[i].bid;
    if(!b.pass) return b;
  }
  return null;
}

function findDeclarer(auction, suit, side) {
  for(const {player, bid} of auction)
    if(player%2===side && !bid.pass && bid.suit===suit) return player;
  return -1;
}

// -- AI: hand evaluation helpers ------------------------------------------------
function bestSuit(h) {
  let best=-1, bLen=0, bHCP=0;
  for(let s=3;s>=0;s--) {
    const l=sLen(h,s), hp=sSuit(h,s).reduce((x,c)=>x+hcp(c),0);
    if(l>bLen||(l===bLen&&hp>bHCP)){best=s;bLen=l;bHCP=hp;}
  }
  return best;
}

// -- AI bidding (faithful to ROM thresholds) ------------------------------------
function aiBid(state, player) {
  const h    = state.hands[player];
  const myHP = hHCP(h);
  const myP  = totPts(h);
  const pard = (player+2)%4;
  const auc  = state.auction;
  const high = highestBid(auc);

  const myBids   = auc.filter(x=>x.player===player  && !x.bid.pass);
  const pardBids = auc.filter(x=>x.player===pard    && !x.bid.pass);
  const oppBids  = auc.filter(x=>x.player%2!==player%2 && !x.bid.pass);

  function tryBid(level, suit) {
    const b = mkBid(level,suit);
    return beats(b,high) ? b : null;
  }

  // Opening bid (no bids yet)
  if (!high) {
    if (myP < 13) return PASS();
    if (myHP >= 20 && myHP <= 21 && isBalanced(h)) return tryBid(2,4)||PASS();
    if (myHP >= 15 && myHP <= 17 && isBalanced(h)) return tryBid(1,4)||PASS();
    const s = bestSuit(h);
    return tryBid(1,s) || PASS();
  }

  // Response to partner's opening
  if (pardBids.length===1 && myBids.length===0 && oppBids.length===0) {
    const pBid = pardBids[0].bid;

    if (pBid.suit===4 && pBid.level===1) {
      if (myHP <= 7)  return PASS();
      if (myHP >= 10) {
        if (sLen(h,3)>=4) return tryBid(4,3)||tryBid(3,4)||PASS();
        if (sLen(h,2)>=4) return tryBid(4,2)||tryBid(3,4)||PASS();
        return tryBid(3,4)||PASS();
      }
      return tryBid(2,4)||PASS();
    }

    if (pBid.suit===4 && pBid.level===2) {
      if (myHP <= 3)  return PASS();
      if (myHP >= 5) {
        if (sLen(h,3)>=5) return tryBid(4,3)||tryBid(3,4)||PASS();
        if (sLen(h,2)>=5) return tryBid(4,2)||tryBid(3,4)||PASS();
        return tryBid(3,4)||PASS();
      }
      return PASS();
    }

    const ps = pBid.suit;
    if (myP >= 13) {
      if (sLen(h,3)>=4 && ps!==3) return tryBid(4,3)||tryBid(3,4)||PASS();
      if (sLen(h,2)>=4 && ps!==2) return tryBid(4,2)||tryBid(3,4)||PASS();
      if (sLen(h,ps)>=3) return tryBid(ps>=2?4:5, ps)||tryBid(3,4)||PASS();
      const ns = bestSuit(h);
      return tryBid(2,ns)||tryBid(3,4)||PASS();
    }
    if (myP >= 10) {
      if (sLen(h,ps)>=3) return tryBid(3,ps)||PASS();
      if (myHP>=10) return tryBid(2,4)||PASS();
      const ns = bestSuit(h);
      return tryBid(ns>ps?1:2, ns)||PASS();
    }
    if (myP >= 6) {
      const ns = bestSuit(h);
      if (sLen(h,ps)>=3) return tryBid(2,ps)||PASS();
      if (ns > ps) return tryBid(1,ns)||PASS();
      return tryBid(2,ns)||PASS();
    }
    return PASS();
  }

  // Rebid (partner responded to our opening)
  if (myBids.length===1 && pardBids.length===1) {
    const pResp = pardBids[0].bid;
    if (!pResp || pResp.pass) return PASS();
    if (myHP >= 18) {
      const s = bestSuit(h);
      if (sLen(h,s)>=5) return tryBid(s>=2?4:5, s)||tryBid(3,4)||PASS();
      return tryBid(2,4)||tryBid(3,4)||PASS();
    }
    if (isBalanced(h) && myHP >= 15) return tryBid(1,4)||tryBid(2,4)||PASS();
    const s = bestSuit(h);
    if (sLen(h,s)>=6) return tryBid(2,s)||PASS();
    if (!pResp.pass && sLen(h,pResp.suit||s)>=4 && myP>=16) {
      const gs = pResp.suit||s;
      return tryBid(gs>=2?4:5, gs)||PASS();
    }
    return PASS();
  }

  // Overcall
  if (oppBids.length>0 && myBids.length===0 && pardBids.length===0) {
    if (myHP < 10) return PASS();
    const s = bestSuit(h);
    if (sLen(h,s) < 5) return PASS();
    return tryBid(high.level, s)||tryBid(high.level+1, s)||PASS();
  }

  // Slam try
  if (myBids.length>=1 && pardBids.length>=1 && high && high.level>=4) {
    const est = myHP + 13;
    if (est >= 33 && high.level<6) {
      return tryBid(6, high.suit)||PASS();
    }
  }

  // Blackwood 4NT response
  if (high && high.suit===4 && high.level===4 && high === (pardBids.length?pardBids[pardBids.length-1].bid:null)) {
    const aces = h.filter(c=>c.rank===14).length;
    const responses = [mkBid(5,0),mkBid(5,1),mkBid(5,2),mkBid(5,3)];
    return responses[aces] || responses[3];
  }

  return PASS();
}

// -- Card play AI ---------------------------------------------------------------
function aiPlay(state, player) {
  const h      = state.hands[player];
  const trick  = state.curTrick;
  const trump  = state.contract.suit < 4 ? state.contract.suit : -1;
  const isDecl = player === state.contract.declarer;
  const pard   = (player+2)%4;

  let legal;
  if (trick.length === 0) {
    legal = [...h];
  } else {
    const led = trick[0].card.suit;
    const onSuit = sSuit(h, led);
    legal = onSuit.length > 0 ? onSuit : [...h];
  }
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];

  // Opening lead
  if (trick.length === 0) {
    if (isDecl && trump >= 0) {
      const ts = sSuit(h, trump);
      if (ts.length > 0) return ts.sort((a,b)=>a.rank-b.rank)[0];
    }
    const suits = [0,1,2,3].filter(s=>s!==trump);
    suits.sort((a,b) => sLen(h,b)-sLen(h,a) || sSuit(h,b).reduce((x,c)=>x+hcp(c),0)-sSuit(h,a).reduce((x,c)=>x+hcp(c),0));
    const best = suits[0] ?? 0;
    const cs   = sSuit(h, best).sort((a,b)=>b.rank-a.rank);
    if (cs.length === 0) return legal[0];
    if (cs.length >= 2 && cs[0].rank - cs[1].rank === 1 && cs[0].rank >= 11) return cs[0];
    return cs[Math.min(3, cs.length-1)];
  }

  const ledSuit = trick[0].card.suit;
  const canFol  = sSuit(h, ledSuit).length > 0;

  if (canFol) {
    const fol = sSuit(h, ledSuit).sort((a,b)=>a.rank-b.rank);
    if (trick.length >= 2) return fol[fol.length-1]; // third hand high
    return fol[0]; // second hand low
  }

  if (trump >= 0) {
    const ts = sSuit(h, trump).sort((a,b)=>a.rank-b.rank);
    if (ts.length > 0) {
      const pardEntry = trick.find(t=>t.player===pard);
      if (!pardEntry || !isCurrentlyWinning(pardEntry.card, trick, trump)) {
        return ts[0];
      }
    }
  }
  const nonT = legal.filter(c=>c.suit!==trump);
  return (nonT.length?nonT:legal).sort((a,b)=>a.rank-b.rank)[0];
}

function isCurrentlyWinning(card, trick, trump) {
  for(const {card:c} of trick) {
    if(c===card) continue;
    if(trump>=0 && c.suit===trump && card.suit!==trump) return false;
    if(c.suit===card.suit && c.rank>card.rank) return false;
  }
  return true;
}

function trickWinner(trick, trump) {
  let win = trick[0];
  for(let i=1;i<trick.length;i++) {
    const c=trick[i].card, wc=win.card;
    if(trump>=0 && c.suit===trump && wc.suit!==trump){win=trick[i];continue;}
    if(c.suit===wc.suit && c.rank>wc.rank) win=trick[i];
  }
  return win.player;
}

// -- Scoring --------------------------------------------------------------------
function scoreContract(contract, tricksMade, vulnerable) {
  const {level, suit, declarer} = contract;
  const isNS  = declarer%2===0;
  const isVul = vulnerable[isNS?0:1];
  const need  = level + 6;

  if (tricksMade < need) {
    const down = need - tricksMade;
    const pen  = isVul ? down*100 : down*50;
    return isNS ? -pen : pen;
  }

  const over     = tricksMade - need;
  const perTrick = suit===4 ? 30 : (suit>=2 ? 30 : 20);
  const ntBonus  = suit===4 ? 10 : 0;
  let trickScore = level * perTrick + ntBonus;

  let bonus = trickScore >= 100 ? (isVul?500:300) : 50;
  if (level===6) bonus += isVul?750:500;
  if (level===7) bonus += isVul?1500:1000;

  const total = trickScore + bonus + over*perTrick;
  return isNS ? total : -total;
}
