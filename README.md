# Discord Store

Mini loja simples para vender licencas de plugins Minecraft.

## Fluxo

1. A staff confirma o pagamento com `!pagar <discordId> <produto>`.
2. O bot cria uma key unica no formato `XXXX-XXXX-XXXX`.
3. A key vai por DM para o comprador.
4. O plugin Spigot ativa com `POST /activate`.
5. O plugin verifica periodicamente com `GET /verify`.

## Como rodar

```bash
npm install
set DISCORD_TOKEN=...
node api.js
node bot.js
```

## Banco

SQLite em `discord-store/data/licenses.db`.

## Endpoints

- `GET /health`
- `POST /activate`
- `GET /verify`

## Regras

- Key só ativa uma vez.
- Depois de ativada, fica presa ao `serverId`.
- A mesma key não ativa em outro servidor.
