// 掼蛋游戏引擎（服务器端，权威模式）
'use strict';

const SUITS = ['spade', 'heart', 'diamond', 'club'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function createDeck() {
  const deck = [];
  let id = 0;
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: id++, suit, rank });
      }
    }
    deck.push({ id: id++, suit: 'joker', rank: 'smallJoker' });
    deck.push({ id: id++, suit: 'joker', rank: 'bigJoker' });
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rankValue(rank, level) {
  if (rank === 'bigJoker') return 17;
  if (rank === 'smallJoker') return 16;
  if (rank === level) return 15;
  if (rank === '2') return 14;
  if (rank === 'A') return 13;
  if (rank === 'K') return 12;
  if (rank === 'Q') return 11;
  if (rank === 'J') return 10;
  return parseInt(rank);
}

function isWild(card, level) {
  return card.suit === 'heart' && card.rank === level;
}

function sortCards(cards, level) {
  return [...cards].sort((a, b) => rankValue(b.rank, level) - rankValue(a.rank, level));
}

function groupByRank(cards, level) {
  const map = new Map();
  for (const c of cards) {
    const v = rankValue(c.rank, level);
    if (!map.has(v)) map.set(v, []);
    map.get(v).push(c);
  }
  return map;
}

// 牌型识别
function identifyPattern(cards, level) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const nonWild = cards.filter(c => !isWild(c, level));
  const wildCount = cards.length - nonWild.length;

  // 天王炸
  const bigJokers = nonWild.filter(c => c.rank === 'bigJoker').length;
  const smallJokers = nonWild.filter(c => c.rank === 'smallJoker').length;
  if (bigJokers + smallJokers + wildCount >= 4 && bigJokers >= 2) {
    return { type: 'kingBomb', length: 4, mainRank: 'bigJoker', cards };
  }

  // 按点数分组（非逢人配）
  const groups = groupByRank(nonWild, level);
  const sizes = [...groups.values()].map(g => g.length).sort((a, b) => b - a);

  // 炸弹（4张及以上同点数，可用逢人配）
  for (const [val, grp] of groups) {
    if (grp.length + wildCount >= 4 && val !== 16 && val !== 17) {
      // 检查是否正好是这个点数+逢人配
      const total = grp.length + wildCount;
      if (total === n) {
        const rankLabel = grp[0].rank;
        return { type: 'bomb', length: total, mainRank: rankLabel, cards };
      }
    }
  }

  // 同花顺（5张同花色连续）
  if (n === 5) {
    const bySuit = new Map();
    for (const c of nonWild) {
      if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
      bySuit.get(c.suit).push(c);
    }
    for (const [suit, scards] of bySuit) {
      if (scards.length + wildCount >= 5) {
        const vals = [...new Set(scards.map(c => rankValue(c.rank, level)))].filter(v => v >= 1 && v <= 13).sort((a, b) => a - b);
        // 检查连续
        for (let start = 1; start <= 9; start++) {
          const needed = new Set([start, start+1, start+2, start+3, start+4]);
          const have = vals.filter(v => needed.has(v));
          if (have.length + wildCount >= 5) {
            return { type: 'straightFlush', length: 5, mainRank: scards[0].rank, cards };
          }
        }
      }
    }
  }

  // 单张
  if (n === 1) return { type: 'single', length: 1, mainRank: cards[0].rank, cards };

  // 对子
  if (n === 2) {
    const v0 = rankValue(cards[0].rank, level);
    const v1 = rankValue(cards[1].rank, level);
    if (v0 === v1 || wildCount >= 1) {
      return { type: 'pair', length: 2, mainRank: cards[0].rank, cards };
    }
  }

  // 三张
  if (n === 3 && sizes[0] + wildCount >= 3) {
    return { type: 'triple', length: 3, mainRank: nonWild[0]?.rank || cards[0].rank, cards };
  }

  // 三带二
  if (n === 5) {
    if (sizes[0] >= 3 && sizes[1] >= 2) {
      const tripleVal = [...groups.entries()].find(([_, g]) => g.length >= 3)[0];
      return { type: 'triplePair', length: 5, mainRank: RANKS[tripleVal - 1] || 'A', cards };
    }
    // 逢人配三带二
    if (sizes[0] >= 2 && sizes[1] >= 2 && wildCount >= 1) {
      return { type: 'triplePair', length: 5, mainRank: nonWild[0]?.rank, cards };
    }
  }

  // 顺子（5张及以上连续）
  if (n >= 5) {
    const vals = [...new Set(nonWild.map(c => rankValue(c.rank, level)))].filter(v => v >= 1 && v <= 13).sort((a, b) => a - b);
    for (let start = 1; start <= 13 - n + 1; start++) {
      const needed = new Set();
      for (let i = 0; i < n; i++) needed.add(start + i);
      const have = vals.filter(v => needed.has(v));
      if (have.length + wildCount >= n) {
        return { type: 'straight', length: n, mainRank: RANKS[start - 1], cards };
      }
    }
  }

  // 连对（3对及以上连续）
  if (n >= 6 && n % 2 === 0) {
    const pairCount = n / 2;
    const vals = [...groups.entries()].filter(([_, g]) => g.length >= 2).map(([v]) => v).filter(v => v >= 1 && v <= 13).sort((a, b) => a - b);
    for (let start = 1; start <= 13 - pairCount + 1; start++) {
      let count = 0;
      for (let i = 0; i < pairCount; i++) {
        if (vals.includes(start + i)) count++;
      }
      if (count + wildCount >= pairCount) {
        return { type: 'straightPair', length: n, mainRank: RANKS[start - 1], cards };
      }
    }
  }

  return null;
}

// 牌型大小比较
function canBeat(pattern, last, level) {
  if (!pattern || !last) return false;
  const typeOrder = { single:0, pair:1, triple:2, triplePair:3, straight:4, straightPair:5, airplane:6, bomb:7, straightFlush:8, kingBomb:9 };

  // 天王炸最大
  if (pattern.type === 'kingBomb') return true;
  if (last.type === 'kingBomb') return false;

  // 同花顺 > 5张炸弹 > 4张炸弹
  if (pattern.type === 'straightFlush') {
    if (last.type === 'bomb') return last.length <= 5;
    if (last.type === 'straightFlush') return rankValue(pattern.mainRank, level) > rankValue(last.mainRank, level);
    return last.type !== 'kingBomb';
  }

  // 炸弹
  if (pattern.type === 'bomb') {
    if (last.type === 'bomb') {
      if (pattern.length !== last.length) return pattern.length > last.length;
      return rankValue(pattern.mainRank, level) > rankValue(last.mainRank, level);
    }
    if (last.type === 'straightFlush') return pattern.length >= 6;
    return true; // 炸弹压普通牌型
  }

  // 普通牌型必须同类型同长度
  if (pattern.type !== last.type || pattern.length !== last.length) return false;
  return rankValue(pattern.mainRank, level) > rankValue(last.mainRank, level);
}

// AI出牌（简单版，用于机器人补位）
function aiFollowPlay(hand, lastPattern, level) {
  // 找所有能压的牌
  const plays = findPlays(hand, lastPattern, level);
  if (plays.length === 0) return null;
  // 优先出非炸弹的最小牌
  const nonBombs = plays.filter(p => {
    const pat = identifyPattern(p, level);
    return pat && pat.type !== 'bomb' && pat.type !== 'straightFlush' && pat.type !== 'kingBomb';
  });
  if (nonBombs.length > 0) return nonBombs[0];
  // 牌少时才用炸弹
  if (hand.length <= 8 && plays.length > 0) return plays[0];
  return null;
}

function aiLeadPlay(hand, level) {
  const sorted = sortCards(hand, level);
  if (hand.length <= 2) return hand;
  // 出最小的单张
  const small = sorted.filter(c => rankValue(c.rank, level) <= 8);
  if (small.length > 0) return [small[small.length - 1]];
  return [sorted[sorted.length - 1]];
}

function findPlays(hand, lastPattern, level) {
  const result = [];
  // 单张
  if (lastPattern.type === 'single') {
    for (const c of hand) {
      const p = identifyPattern([c], level);
      if (p && canBeat(p, lastPattern, level)) result.push([c]);
    }
  }
  // 对子
  if (lastPattern.type === 'pair') {
    const groups = groupByRank(hand, level);
    for (const [_, g] of groups) {
      if (g.length >= 2) {
        const play = g.slice(0, 2);
        const p = identifyPattern(play, level);
        if (p && canBeat(p, lastPattern, level)) result.push(play);
      }
    }
  }
  // 炸弹
  const groups = groupByRank(hand, level);
  for (const [val, g] of groups) {
    if (g.length >= 4 && val < 16) {
      const play = g.slice(0, 4);
      const p = identifyPattern(play, level);
      if (p && canBeat(p, lastPattern, level)) result.push(play);
    }
  }
  return result;
}

module.exports = {
  createDeck, shuffle, rankValue, isWild, sortCards, identifyPattern, canBeat,
  aiFollowPlay, aiLeadPlay, SUITS, RANKS
};
