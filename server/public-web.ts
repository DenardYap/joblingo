import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address,prefix,'ipv4');
for (const [address,prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]] as const) blocked.addSubnet(address,prefix,'ipv6');

export async function publicGet(value: string, limit = 2_000_000, redirects = 0): Promise<{ status: number; url: string; type: string; body: Buffer }> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || redirects > 4) throw new Error('Unsupported public URL.');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => blocked.check(a.address, a.family === 4 ? 'ipv4' : 'ipv6'))) throw new Error('Only public websites can be retrieved.');
  const address = addresses.find((a) => a.family === 4) ?? addresses[0]!;
  return new Promise((resolve, reject) => {
    // Pin the checked address, including after redirects, to prevent DNS rebinding.
    const req = request(url, { family: address.family, lookup: (_hostname, _options, callback) => callback(null, address.address, address.family), headers: { 'User-Agent': 'PersonalJobWorkspace/1.0', Accept: 'text/html,application/json,image/*;q=0.8' } }, (res) => {
      if (res.statusCode && [301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume(); clearTimeout(timer);
        publicGet(new URL(res.headers.location,url).href,limit,redirects+1).then(resolve,reject); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limit) req.destroy(new Error('Page is too large.')); else chunks.push(chunk); });
      res.on('end', () => { clearTimeout(timer); resolve({status:res.statusCode ?? 0,url:url.href,type:String(res.headers['content-type'] ?? ''),body:Buffer.concat(chunks)}); });
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('Website request timed out.')), 15000);
    req.on('error', (error) => { clearTimeout(timer); reject(error); }); req.end();
  });
}
