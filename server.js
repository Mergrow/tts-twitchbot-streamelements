const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const tmi = require('tmi.js');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 5000;
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

app.use(express.static(__dirname));

function getTimestamp() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

function getDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

function logToFile(line) {
  const logPath = path.join(logsDir, `${getDateString()}.log`);
  fs.appendFile(logPath, line + '\n', err => {
    if (err) console.error('Erro ao escrever no log:', err);
  });
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  console.log(`Novo cliente conectado via IP ${ip}`);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.action === 'connect' && data.channel) {
        const channel = data.channel.toLowerCase();

        // Se já existe cliente TMI, desconecta antes
        if (ws.twitchClient) {
          try {
            await ws.twitchClient.disconnect();
            console.log(`Desconectado do canal anterior`);
          } catch (e) {
            console.warn('Erro ao desconectar cliente TMI anterior:', e);
          }
        }

        console.log(`Conectando no canal: ${channel}`);
        logToFile(`[${getTimestamp()}][#${channel}][IP ${ip}] Conectado ao canal`);

        // Cria cliente TMI com variáveis de sistema
        const client = new tmi.Client({
          options: { debug: false },
          identity: {
            username: process.env.TWITCH_BOT_USERNAME,
            password: process.env.TWITCH_OAUTH_TOKEN,
          },
          channels: [channel],
        });

        client.on('error', (err) => {
          console.error('Erro no cliente TMI:', err);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ system: `Erro no Twitch Client: ${err.message}` }));
          }
        });

        const messageHandler = (chan, tags, msg, self) => {
          if (self) return;

          const user = tags['display-name'] || tags['username'];
          const content = msg.trim();
          const timestamp = getTimestamp();
          let ttsContent = null;

          if (content.startsWith('!voz ')) {
            ttsContent = content.slice(5).trim();
            if (!ttsContent) ttsContent = null;
          }

          const logLine = `[${timestamp}][#${channel}][${user}][${content}]`;
          console.log(logLine);
          logToFile(logLine);

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              user,
              message: content,
              ttsContent: ttsContent || null,
            }));
          }
        };

        client.removeAllListeners('message');
        client.on('message', messageHandler);

        await client.connect();
        ws.twitchClient = client;

        ws.send(JSON.stringify({ system: `Conectado no canal: ${channel}` }));
      }
    } catch (err) {
      console.error('Erro ao processar mensagem:', err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ system: `Erro: ${err.message}` }));
      }
    }
  });

  ws.on('close', async () => {
    if (ws.twitchClient) {
      try {
        await ws.twitchClient.disconnect();
        console.log('Cliente TMI desconectado');
      } catch (e) {
        console.warn('Erro ao desconectar TMI no close:', e);
      }
    }
    console.log('Cliente WebSocket desconectado');
  });

  ws.on('error', (err) => {
    console.error('Erro na conexão WebSocket:', err);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
