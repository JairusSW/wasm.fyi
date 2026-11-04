import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function applyAgentStartupRetry(root){
 const path=join(root,'agent/client.go');let source=await readFile(path,'utf8');
 if(!source.includes('startIsolatedOnce(')){
  const declaration='type Client struct {';
  const start='func StartIsolated(parent context.Context, command []string, logPath string, timeout time.Duration, policy ResourcePolicy) (*Client, error) {';
  const seam='\treq.ID = c.id\n';
  for(const anchor of [declaration,start,seam])if(!source.includes(anchor))throw Error('Agent startup retry seam changed');
  source=source.replace(declaration,declaration+'\n\tstartupDescription *protocol.Response');
  source=source.replace(start,start.replace('StartIsolated','startIsolatedOnce'));
  source=source.replace(seam,seam+`\tif c.startupDescription != nil {
\t\tcached := c.startupDescription
\t\tc.startupDescription = nil
\t\tif req.Method == "describe" { response := *cached; response.ID = req.ID; return response, nil }
\t}
`);
  await writeFile(path,source);
 }
 for(const name of ['startup_retry.go','startup_retry_test.go'])await copyFile(fileURLToPath(new URL('../../adapters/agent/'+name,import.meta.url)),join(root,'agent',name));
}
