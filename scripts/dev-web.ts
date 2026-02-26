import { createServer } from 'node:net';
import { resolve } from 'node:path';

type ChildProcess = {
    name: string;
    proc: ReturnType<typeof Bun.spawn>;
};

function spawnProcess(
    name: string,
    command: string[],
    options?: { cwd?: string; env?: Record<string, string | undefined> },
): ChildProcess {
    console.log(`[dev-web] starting ${name}: ${command.join(' ')}`);
    return {
        name,
        proc: Bun.spawn(command, {
            cwd: options?.cwd,
            env: options?.env ? { ...process.env, ...options.env } : process.env,
            stderr: 'inherit',
            stdout: 'inherit',
        }),
    };
}

const apiPort = await chooseApiPort();
const configPath = resolve(import.meta.dir, '../config.json');
const children: ChildProcess[] = [
    spawnProcess('api', ['bun', 'src/web-api/server.ts'], {
        env: {
            BPB_CONFIG_PATH: configPath,
            BPB_WEB_API_PORT: apiPort,
        },
    }),
    spawnProcess('web', ['bun', 'node_modules/vite/bin/vite.js', '--host'], {
        cwd: 'apps/web',
        env: {
            VITE_BPB_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
        },
    }),
];

let shuttingDown = false;
const shutdown = () => {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    for (const child of children) {
        try {
            child.proc.kill();
        } catch {
            // No-op if process already exited.
        }
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const exits = children.map(async (child) => ({
    exitCode: await child.proc.exited,
    name: child.name,
}));

const firstExit = await Promise.race(exits);
if (!shuttingDown) {
    console.error(`[dev-web] ${firstExit.name} exited (${firstExit.exitCode}), stopping remaining processes`);
    shutdown();
}

process.exitCode = shuttingDown ? 0 : firstExit.exitCode === 0 ? 0 : 1;

async function chooseApiPort(): Promise<string> {
    const envPort = Bun.env.BPB_WEB_API_PORT;
    if (envPort) {
        return envPort;
    }

    for (const port of [8787, 8799, 8800, 8801, 8802]) {
        if (await isPortAvailable(port)) {
            return String(port);
        }
    }

    return '8787';
}

async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}
