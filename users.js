import { loadHTML, useTabCSS } from '../utils.js';
export default async function view(){
  useTabCSS('users');                             // inject tabs/users.css
  const frag = await loadHTML('tabs/users.html'); // load HTML partial
  const root = frag.querySelector([data-view='users']);
  return root;
}
