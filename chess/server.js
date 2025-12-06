const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');

const app = express();

// CONFIGURATION - EDIT THESE!
const BOT_TOKEN = '8542066031:AAGQw7P9VJXaLX8-cB70XuIDbwyHgwCXpZE'; // ⬅️ REPLACE WITH YOUR BOT TOKEN
const WEB_APP_URL = 'https://chessgame-jy4w.onrender.com'; // Your Render URL
const INITIAL_BALANCE = 10; // Bonus for new users
const WIN_REWARD = 10; // Reward per win

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const PORT = process.env.PORT || 3000;

// Database
const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const gamesFile = path.join(dataDir, 'games.json');

// Initialize DB
async function initDB() {
    await fs.mkdir(dataDir, { recursive: true });
    try { await fs.access(usersFile); } catch { await fs.writeFile(usersFile, JSON.stringify({})); }
    try { await fs.access(gamesFile); } catch { await fs.writeFile(gamesFile, JSON.stringify({})); }
}

// User functions
async function getUsers() { 
    try { 
        return JSON.parse(await fs.readFile(usersFile, 'utf8')); 
    } catch { 
        return {}; 
    }
}

async function saveUsers(users) { 
    await fs.writeFile(usersFile, JSON.stringify(users, null, 2)); 
}

async function getGames() { 
    try { 
        return JSON.parse(await fs.readFile(gamesFile, 'utf8')); 
    } catch { 
        return {}; 
    }
}

async function saveGames(games) { 
    await fs.writeFile(gamesFile, JSON.stringify(games, null, 2)); 
}

async function getUser(userId) {
    const users = await getUsers();
    return users[userId] || null;
}

async function createUser(userId, userData) {
    const users = await getUsers();
    
    if (!users[userId]) {
        users[userId] = {
            id: userId,
            username: userData.username || `user_${userId}`,
            first_name: userData.first_name || '',
            balance: INITIAL_BALANCE,
            created_at: new Date().toISOString(),
            last_login: new Date().toISOString(),
            games_played: 0,
            games_won: 0,
            total_earned: INITIAL_BALANCE,
            is_active: true
        };
        
        await saveUsers(users);
        console.log(`✅ New user: ${users[userId].username}`);
        return { success: true, user: users[userId], is_new: true };
    } else {
        users[userId].last_login = new Date().toISOString();
        await saveUsers(users);
        return { success: true, user: users[userId], is_new: false };
    }
}

async function updateBalance(userId, amount) {
    const users = await getUsers();
    if (users[userId]) {
        users[userId].balance += amount;
        if (amount > 0) users[userId].total_earned += amount;
        await saveUsers(users);
        return users[userId].balance;
    }
    return null;
}

// Game functions
async function createGame(player1Id, player2Id = null) {
    const games = await getGames();
    const gameId = uuidv4();
    const chess = new Chess();
    
    games[gameId] = {
        id: gameId,
        player1: player1Id,
        player2: player2Id,
        current_player: player1Id,
        fen: chess.fen(),
        pgn: chess.pgn(),
        status: player2Id ? 'active' : 'waiting',
        created_at: new Date().toISOString(),
        moves: [],
        winner: null,
        last_move_at: new Date().toISOString()
    };
    
    await saveGames(games);
    return games[gameId];
}

async function makeMove(gameId, playerId, move) {
    const games = await getGames();
    const game = games[gameId];
    
    if (!game || game.status !== 'active' || game.current_player !== playerId) {
        return { success: false, error: 'Invalid move' };
    }
    
    const chess = new Chess(game.fen);
    try {
        const result = chess.move(move);
        
        if (result) {
            game.fen = chess.fen();
            game.pgn = chess.pgn();
            game.moves.push({
                player: playerId,
                move: move,
                san: result.san,
                timestamp: new Date().toISOString()
            });
            
            game.current_player = game.current_player === game.player1 ? game.player2 : game.player1;
            game.last_move_at = new Date().toISOString();
            
            if (chess.isGameOver()) {
                game.status = 'finished';
                if (chess.isCheckmate()) {
                    game.winner = playerId;
                    await updateBalance(playerId, WIN_REWARD);
                    
                    const users = await getUsers();
                    if (users[playerId]) users[playerId].games_won += 1;
                    if (users[game.player1]) users[game.player1].games_played += 1;
                    if (users[game.player2]) users[game.player2].games_played += 1;
                    await saveUsers(users);
                } else {
                    const users = await getUsers();
                    if (users[game.player1]) users[game.player1].games_played += 1;
                    if (users[game.player2]) users[game.player2].games_played += 1;
                    await saveUsers(users);
                }
            }
            
            await saveGames(games);
            return { success: true, game: game, is_game_over: chess.isGameOver() };
        }
    } catch (error) {
        console.error('Invalid move:', error);
    }
    
    return { success: false, error: 'Invalid move' };
}

// Bot commands
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'Player';
    
    const welcomeMessage = `♟️ *Welcome to Chess Master, ${firstName}!* ♟️

💰 *Get ${INITIAL_BALANCE} birr FREE* for registering!
🏆 *Win ${WIN_REWARD} birr* for every game you win!
🎮 Play real-time chess with friends
📱 No downloads needed - play in Telegram

*How to play:*
1. Click "Register & Play" below
2. Create your account
3. Get your ${INITIAL_BALANCE} birr bonus
4. Start playing and earning!

Click below to begin! 🎮`;
    
    const keyboard = {
        inline_keyboard: [[
            {
                text: "🎮 Register & Play",
                web_app: { url: `${WEB_APP_URL}?start=${userId}` }
            }
        ]]
    };
    
    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const user = await getUser(userId);
    if (user) {
        bot.sendMessage(chatId, `💰 *Balance: ${user.balance} birr*\n🏆 *Wins: ${user.games_won} games*\n💰 *Total earned: ${user.total_earned} birr*`, {
            parse_mode: 'Markdown'
        });
    } else {
        bot.sendMessage(chatId, "Please register first! Use /start");
    }
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆘 *Help*\n\n/start - Register & play\n/balance - Check balance\n/help - Show this message`, {
        parse_mode: 'Markdown'
    });
});

// API endpoints
app.use(express.json());
app.use(express.static('public'));

app.post('/api/user/create', async (req, res) => {
    try {
        const { userId, username, firstName } = req.body;
        const result = await createUser(userId, { username, first_name: firstName });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await getUser(req.params.id);
        if (user) {
            res.json({
                id: user.id,
                username: user.username,
                first_name: user.first_name,
                balance: user.balance,
                games_played: user.games_played,
                games_won: user.games_won,
                total_earned: user.total_earned,
                created_at: user.created_at
            });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/user/:id/balance', async (req, res) => {
    try {
        const { amount } = req.body;
        const newBalance = await updateBalance(req.params.id, amount);
        if (newBalance !== null) {
            res.json({ success: true, balance: newBalance });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/game', async (req, res) => {
    try {
        const { playerId } = req.body;
        const game = await createGame(playerId);
        res.json({ success: true, game });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/game/:id', async (req, res) => {
    try {
        const games = await getGames();
        const game = games[req.params.id];
        if (game) {
            res.json(game);
        } else {
            res.status(404).json({ error: 'Game not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/game/:id/move', async (req, res) => {
    try {
        const { playerId, move } = req.body;
        const result = await makeMove(req.params.id, playerId, move);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/game/:id/join', async (req, res) => {
    try {
        const { playerId } = req.body;
        const games = await getGames();
        const game = games[req.params.id];
        
        if (!game) return res.status(404).json({ error: 'Game not found' });
        if (game.player2) return res.status(400).json({ error: 'Game full' });
        
        game.player2 = playerId;
        game.status = 'active';
        await saveGames(games);
        
        res.json({ success: true, game });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const users = await getUsers();
        const leaderboard = Object.values(users)
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 20)
            .map(user => ({
                username: user.username,
                first_name: user.first_name,
                balance: user.balance,
                games_won: user.games_won
            }));
        res.json(leaderboard);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function start() {
    await initDB();
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 10)}...`);
        console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
        console.log(`💰 Bonus: ${INITIAL_BALANCE} birr`);
        console.log(`🏆 Win: ${WIN_REWARD} birr`);
        console.log(`\n📢 Bot is ready!`);
    });
}

start().catch(console.error);
