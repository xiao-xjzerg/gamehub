import {stdin,stdout} from 'node:process';
import {emitKeypressEvents} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {openStore} from '../server/store.mjs';
import {hasAdminAccount,provisionAdmin,validAdminPassword} from '../server/admin-auth.mjs';

if(!stdin.isTTY || !stdout.isTTY)throw new Error('请在本机或 SSH 交互终端运行，密码不能通过命令参数传入');
if(process.argv.length>3 || (process.argv[2] && process.argv[2]!=='--reset'))throw new Error('用法：node scripts/admin-password.mjs [--reset]');

emitKeypressEvents(stdin);
function hidden(question) {
  return new Promise((resolve,reject)=>{
    let value='';
    stdout.write(question);
    stdin.setRawMode(true);stdin.resume();
    const finish=(error)=>{
      stdin.off('keypress',onKey);stdin.setRawMode(false);stdin.pause();stdout.write('\n');
      error?reject(error):resolve(value);
    };
    function onKey(char,key){
      if(key?.ctrl && key.name==='c')return finish(new Error('已取消'));
      if(key?.name==='return' || key?.name==='enter')return finish();
      if(key?.name==='backspace'){value=value.slice(0,-1);return;}
      if(char && !key?.ctrl && !key?.meta && !char.startsWith('\u001b') && value.length<256)value+=char;
    }
    stdin.on('keypress',onKey);
  });
}

const database=process.env.GAMEHUB_DB || fileURLToPath(new URL('../../data/gamehub.sqlite',import.meta.url));
const db=openStore(database);
try {
  const reset=process.argv[2]==='--reset';
  if(hasAdminAccount(db) && !reset)throw new Error('管理员已设置；请登录后台修改密码。若忘记密码，可在服务器终端加 --reset 重置');
  const password=await hidden('管理员密码（6–128 个字符，输入时不显示）：');
  if(!validAdminPassword(password))throw new Error('密码需为 6–128 个字符');
  const repeated=await hidden('再次输入密码：');
  if(password!==repeated)throw new Error('两次输入不一致');
  await provisionAdmin(db,password,{reset});
  stdout.write('管理员密码已设置。请在管理页面登录。\n');
} finally {db.close();}
