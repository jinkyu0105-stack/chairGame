import { getStore } from '@netlify/blobs';

const MAX_PLAYERS = 20;
const animals = ['🐰','🦊','🐼','🐨','🐯','🐸','🐶','🐱','🐵','🦁','🐷','🦄','🐮','🐹','🐻','🐙','🦉','🐧','🐝','🦖'];
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const id = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const code = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const chairs = (count) => Array.from({ length: count }, (_, i) => {
  const a = (Math.PI * 2 * i) / count - Math.PI / 2;
  return { x: Math.round(480 + Math.cos(a) * 190), y: Math.round(320 + Math.sin(a) * 150) };
});
const publicRoom = (room) => ({ phase: room.phase, countdown: room.countdown, chairCountdown: room.chairCountdown, players: room.players, chairs: room.chairs, bananas: room.bananas });

function advance(room) {
  const now = Date.now();
  if (room.phase === 'countdown') {
    room.countdown = Math.max(1, Math.ceil((room.until - now) / 1000));
    if (now >= room.until) { room.phase = 'music'; room.until = now + 10000 + Math.floor(Math.random() * 15000); room.countdown = 0; }
  } else if (room.phase === 'music' && now >= room.until) {
    room.phase = 'chairs'; room.until = now + 8000; room.chairCountdown = 8; room.chairs = chairs(Math.max(1, room.players.filter(p => p.alive).length - 1));
  } else if (room.phase === 'chairs') {
    room.chairCountdown = Math.max(0, Math.ceil((room.until - now) / 1000));
    if (now >= room.until) {
      const alive = room.players.filter(p => p.alive);
      if (alive.length <= 1) room.phase = 'finished';
      else {
        const loser = alive.sort((a, b) => Math.hypot(a.x - 480, a.y - 320) - Math.hypot(b.x - 480, b.y - 320)).pop();
        loser.alive = false; room.phase = 'result'; room.until = now + 2500;
      }
    }
  } else if (room.phase === 'result' && now >= room.until) {
    if (room.players.filter(p => p.alive).length <= 1) room.phase = 'finished';
    else { room.phase = 'music'; room.until = now + 10000 + Math.floor(Math.random() * 15000); room.chairs = []; }
  }
}

function newRoom() { return { phase: 'waiting', players: [], chairs: [], bananas: [{ x: 350, y: 290 }, { x: 630, y: 360 }], countdown: 0, chairCountdown: 0, host: '', until: 0 }; }
function add(room, name) {
  if (room.players.length >= MAX_PLAYERS) throw Error('방이 가득 찼습니다.');
  const player = { id: id(), name: String(name || '동물').slice(0, 10), animal: animals[room.players.length % animals.length], x: 340 + (room.players.length % 4) * 92, y: 230 + Math.floor(room.players.length / 4) * 85, alive: true, score: 0 };
  room.players.push(player); if (!room.host) room.host = player.id; return player;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ message: 'POST 요청만 가능합니다.' }, 405);
  try {
    const body = await request.json(); const store = getStore('chair-game');
    let room;
    if (body.type === 'create') {
      let roomCode = code(); while (await store.get(`room:${roomCode}`)) roomCode = code();
      room = newRoom(); const player = add(room, body.name); await store.setJSON(`room:${roomCode}`, room);
      return json({ type: 'joined', id: player.id, room: roomCode, host: true, state: publicRoom(room) });
    }
    const roomCode = String(body.room || '').toUpperCase(); room = await store.get(`room:${roomCode}`, { type: 'json' });
    if (!room) throw Error('방을 찾을 수 없습니다.'); advance(room);
    if (body.type === 'join') {
      if (room.phase !== 'waiting') throw Error('이미 시작한 게임에는 입장할 수 없습니다.');
      const player = add(room, body.name); await store.setJSON(`room:${roomCode}`, room);
      return json({ type: 'joined', id: player.id, room: roomCode, host: false, state: publicRoom(room) });
    }
    const player = room.players.find(p => p.id === body.id);
    if (!player) throw Error('참가자 정보를 찾을 수 없습니다.');
    if (body.type === 'start') {
      if (room.host !== player.id) throw Error('방장만 시작할 수 있습니다.');
      if (room.phase === 'finished') { room = newRoom(); room.host = player.id; room.players = [{ ...player, x: 480, y: 320, alive: true }]; }
      if (room.phase === 'waiting') {
        // 혼자 연습할 때도 바로 게임 흐름을 확인할 수 있도록 연습 상대를 넣습니다.
        if (room.players.length === 1) { add(room, '연습 여우'); add(room, '연습 판다'); }
        room.phase = 'countdown'; room.countdown = 3; room.until = Date.now() + 3000;
      }
    } else if (body.type === 'move' && player.alive && ['music', 'chairs'].includes(room.phase)) {
      const k = body.keys || {}; const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0); const dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
      if (dx || dy) { const length = Math.hypot(dx, dy); player.x = clamp(player.x + dx / length * 34, 54, 906); player.y = clamp(player.y + dy / length * 34, 54, 586); }
    } else if (body.type === 'action' && body.action === 'banana' && player.alive) {
      room.bananas = [...room.bananas.slice(-23), { x: player.x, y: player.y }];
    }
    await store.setJSON(`room:${roomCode}`, room); return json({ type: 'state', state: publicRoom(room) });
  } catch (error) { return json({ type: 'error', message: error.message || '요청 처리에 실패했습니다.' }, 400); }
};
