import { Context } from '@deepseek-ai/cordis'
import { apply, inject, type ClientRequest, type ConnectionConfig, type HostConnectionHandle, type PeerScope } from '@deepseek-ai/dsh-client-connection'
import { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { provideBrowserCredentials } from './tests/browser-credentials.ts'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'

const ctx = new Context()
provideBrowserCredentials(ctx)
const fiber = ctx.plugin({ inject: [...inject], apply })
await fiber.await()

const connection = ctx.get('connection') as HostConnectionHandle
console.log('connection?', connection !== undefined)
const auth = await BrowserAuth.create(ctx[Context.root], ctx.credentials, 30)
const url = auth.authenticatedUrl('http://localhost/')
const state: any = {}
const chunks: Buffer[] = []
const response: any = Object.assign(new EventEmitter(), {
  writableEnded: false,
  writeHead(value: number, headers?: Record<string, string>) { state.status = value; if (headers) state.headers = headers; return this },
  write(value: any) { chunks.push(Buffer.from(value)); return true },
  end(value?: unknown) { if (value !== undefined) chunks.push(Buffer.from(value as any)); this.writableEnded = true; return this },
})
const request: any = Readable.from([])
Object.assign(request, { url: new URL(url).pathname + new URL(url).search, method: 'GET', headers: { host: 'localhost' }, socket: { destroyed: false } })
console.log('authorizeIndex...')
auth.authorizeIndex(request, response)
console.log('state', state.status, state.headers?.['set-cookie'] !== undefined)
const cookie = state.headers?.['set-cookie']?.split(';', 1)[0]
const admitted = connection.admit({ headers: { host: 'localhost', cookie }, method: 'GET', url: new URL('http://localhost/'), transport: 'http', socket: { destroyed: false } } as any)
console.log('admitted keys', Object.keys(admitted), 'rejection' in admitted)
if ('peer' in admitted) {
  console.log('peer?', admitted.peer !== undefined, 'principal', admitted.peer.principal)
  console.log('browserPeer', connection.browserPeer.id)
}
await fiber.dispose()
