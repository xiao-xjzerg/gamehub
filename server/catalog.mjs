import {readFileSync} from 'node:fs';
export const games = JSON.parse(readFileSync(new URL('../shared/games.json',import.meta.url),'utf8'));
const descriptions = {
  happyjump:'掌握蓄力节奏，跳向下一个平台。',
  '3d-runway':'切换跑道、躲开障碍，收集更多金币。',
  gogodown:'一路向下，在移动的平台之间挑战更深楼层。',
  solovs:'走位、翻滚与近战，迎接一场 BOSS 对决。'
};
export const publicGames = games.map(({id,name,mode,rulesVersion,ranking,available=true}) => ({id,name,mode,rulesVersion,ranking,available,description:descriptions[id] || '',playUrl:available?`/gamehub/play/${id}/`:null,coverUrl:`/gamehub/assets/${id}-cover.webp`}));
export function gameFor(id, mode, version) {
  return games.find(g=>g.id===id && g.mode===mode && g.rulesVersion===version && g.available!==false);
}
