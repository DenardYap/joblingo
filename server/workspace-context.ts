import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage<string>();
export function workspaceId() {
  const id = context.getStore();
  if (!id) throw new Error('A signed-in workspace is required.');
  return id;
}
export function inWorkspace<T>(id:string, action:()=>T):T {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid workspace.');
  return context.run(id,action);
}
