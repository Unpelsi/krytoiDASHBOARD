# krytoiDASHBOARD

Панель для приватного Minecraft сервера — как Aternos, только у тебя дома. Запуск/стоп, live консоль, файлы, плагины Modrinth, игроки (RCON), Telegram, параметры запуска.

## Возможности
- **Статус** — Запустить/Остановить/Перезапуск, CPU/RAM, игроки live (RCON или логи)
- **Консоль** — WebSocket live + история ^v, команды say/time/whitelist/ban
- **Файлы** — проводник по mc-server/, загрузка/скачивание/удаление/редактирование
- **Плагины** — поиск Modrinth с фильтром по версии/лоадеру, бесконечная лента, установка в один клик в plugins/
- **Игроки** — онлайн с аватарками crafatar, кик/бан/тп, RCON
- **Настройки** — server.properties, авторизация, Telegram, параметры запуска (Xmx/Xms/java/jar/флаги), папка сервера без переноса

## Быстрый старт
`ash
npm install
npm start
# http://localhost:3000  login: admin / admin
`

## Подключить свой сервер без переноса
Панель по умолчанию смотрит в mc-server/. Если сервер уже есть (например /home/ubuntu):
Настройки > Папка сервера > вставь /home/ubuntu > Подключить
или: MC_DIR=/home/ubuntu pm2 start server.js --name krytoi

## Деплой на Oracle Ubuntu
`ash
sudo apt update && sudo apt install -y openjdk-21-jre-headless nodejs npm git
git clone https://github.com/Unpelsi/krytoiDASHBOARD.git
cd krytoiDASHBOARD && npm install
MC_DIR=/home/ubuntu pm2 start server.js --name krytoi
pm2 save; pm2 startup
`

## API
GET /api/status POST /api/start|stop|restart POST /api/command GET /api/files GET /api/plugins/search WS /ws

