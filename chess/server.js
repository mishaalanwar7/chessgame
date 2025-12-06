const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const app = express();

// CONFIGURATION
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

// Email/Password Registration
async function registerUser(userData) {
    const users = await getUsers();
    
    // Check if email already exists
    const existingUser = Object.values(users).find(u => u.email === userData.email);
    if (existingUser) {
        return { success: false, error: 'Email already registered' };
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(userData.password, salt);
    
    const userId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    users[userId] = {
        id: userId,
        email: userData.email,
        password: hashedPassword,
        username: userData.email.split('@')[0],
        telegram_id: userData.telegramId || null,
        first_name: userData.firstName || '',
        balance: INITIAL_BALANCE,
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
        games_played: 0,
        games_won: 0,
        vs_computer_wins: 0,
        total_earned: INITIAL_BALANCE,
        is_active: true,
        is_verified: false
    };
    
    await saveUsers(users);
    console.log(`✅ New user registered: ${users[userId].email}`);
    return { success: true, user: users[userId] };
}

async function loginUser(email, password) {
    const users = await getUsers();
    
    // Find user by email
    const user = Object.values(users).find(u => u.email === email);
    if (!user) {
        return { success: false, error: 'User not found' };
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
        return { success: false, error: 'Invalid password' };
    }
    
    // Update last login
    user.last_login = new Date().toISOString();
    await saveUsers(users);
    
    return { success: true, user };
}

async function getUserById(userId) {
    const users = await getUsers();
    return users[userId] || null;
}

async function getUserByEmail(email) {
    const users = await getUsers();
    return Object.values(users).find(u => u.email === email) || null;
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
async function createGame(player1Id, player2Id = null, vsComputer = false) {
    const games = await getGames();
    const gameId = uuidv4();
    const chess = new Chess();
    
    games[gameId] = {
        id: gameId,
        player1: player1Id,
        player2: player2Id,
        vs_computer: vsComputer,
        computer_difficulty: 'medium',
        current_player: player1Id,
        fen: chess.fen(),
        pgn: chess.pgn(),
        status: (player2Id || vsComputer) ? 'active' : 'waiting',
        created_at: new Date().toISOString(),
        moves: [],
        winner: null,
        last_move_at: new Date().toISOString(),
        game_type: vsComputer ? 'computer' : (player2Id ? 'friend' : 'waiting')
    };
    
    await saveGames(games);
    return games[gameId];
}

// Computer AI moves (simple)
function getComputerMove(fen) {
    const chess = new Chess(fen);
    const moves = chess.moves();
    if (moves.length === 0) return null;
    
    // Simple AI: capture if possible, otherwise random
    const captureMoves = moves.filter(move => move.includes('x'));
    if (captureMoves.length > 0) {
        return captureMoves[Math.floor(Math.random() * captureMoves.length)];
    }
    
    // Check moves
    const checkMoves = moves.filter(move => move.includes('+'));
    if (checkMoves.length > 0) {
        return checkMoves[Math.floor(Math.random() * checkMoves.length)];
    }
    
    // Random move
    return moves[Math.floor(Math.random() * moves.length)];
}

async function makeMove(gameId, playerId, move, isComputer = false) {
    const games = await getGames();
    const game = games[gameId];
    
    if (!game || game.status !== 'active' || (game.current_player !== playerId && !isComputer)) {
        return { success: false, error: 'Invalid move or not your turn' };
    }
    
    const chess = new Chess(game.fen);
    
    try {
        const result = chess.move(isComputer ? move : move);
        
        if (result) {
            game.fen = chess.fen();
            game.pgn = chess.pgn();
            game.moves.push({
                player: playerId,
                move: move,
                san: result.san,
                timestamp: new Date().toISOString(),
                is_computer: isComputer
            });
            
            // Update current player
            if (game.vs_computer) {
                game.current_player = playerId; // Still player's turn for computer games
            } else {
                game.current_player = game.current_player === game.player1 ? game.player2 : game.player1;
            }
            
            game.last_move_at = new Date().toISOString();
            
            // Check if game is over
            if (chess.isGameOver()) {
                game.status = 'finished';
                if (chess.isCheckmate()) {
                    game.winner = playerId;
                    
                    // Award winner (except vs computer)
                    if (!game.vs_computer) {
                        const reward = WIN_REWARD;
                        await updateBalance(playerId, reward);
                    } else {
                        // Update computer game stats
                        const users = await getUsers();
                        if (users[playerId]) {
                            users[playerId].vs_computer_wins += 1;
                        }
                        await saveUsers(users);
                    }
                    
                    // Update stats
                    const users = await getUsers();
                    if (users[playerId]) users[playerId].games_won += 1;
                    if (users[game.player1]) users[game.player1].games_played += 1;
                    if (users[game.player2]) users[game.player2].games_played += 1;
                    await saveUsers(users);
                } else {
                    // Draw
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
🤖 Play vs Computer or 👥 Challenge Friends
📱 Mobile-optimized & Easy to play

*Features:*
• Email/Password registration
• Play vs Computer (AI)
• Play vs Friends
• Earn real money
• Mobile-friendly interface
• Game history & stats

Click below to register and play! 🎮`;
    
    const keyboard = {
        inline_keyboard: [[
            {
                text: "🎮 Register & Play",
                web_app: { url: `${WEB_APP_URL}` }
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
    
    // Check if user exists in our system
    const users = await getUsers();
    const user = Object.values(users).find(u => u.telegram_id == userId);
    
    if (user) {
        bot.sendMessage(chatId, `💰 *Balance: ${user.balance} birr*\n🏆 *Wins: ${user.games_won} games*\n🤖 *Computer Wins: ${user.vs_computer_wins || 0}*\n💰 *Total earned: ${user.total_earned} birr*`, {
            parse_mode: 'Markdown'
        });
    } else {
        bot.sendMessage(chatId, "Please register first in the Mini App! Use /start");
    }
});

bot.onText(/\/play/, (msg) => {
    const chatId = msg.chat.id;
    
    const playKeyboard = {
        inline_keyboard: [
            [{ text: "🎮 Open Chess App", web_app: { url: WEB_APP_URL } }],
            [{ text: "🤖 vs Computer", callback_data: 'play_computer' }],
            [{ text: "👥 vs Friend", callback_data: 'play_friend' }]
        ]
    };
    
    bot.sendMessage(chatId, "Choose game mode:", {
        reply_markup: playKeyboard
    });
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    
    if (data === 'play_computer') {
        bot.sendMessage(msg.chat.id, "Open the Mini App to play vs Computer!", {
            reply_markup: {
                inline_keyboard: [[
                    { text: "🎮 Open App", web_app: { url: `${WEB_APP_URL}?mode=computer` } }
                ]]
            }
        });
    } else if (data === 'play_friend') {
        bot.sendMessage(msg.chat.id, "Open the Mini App to play vs Friend!", {
            reply_markup: {
                inline_keyboard: [[
                    { text: "🎮 Open App", web_app: { url: `${WEB_APP_URL}?mode=friend` } }
                ]]
            }
        });
    }
    
    bot.answerCallbackQuery(callbackQuery.id);
});

// API endpoints
app.use(express.json());
app.use(express.static('public'));

// Auth endpoints
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, telegramId } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }
        
        const result = await registerUser({
            email,
            password,
            firstName,
            telegramId
        });
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }
        
        const result = await loginUser(email, password);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// User endpoints
app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await getUserById(req.params.id);
        if (user) {
            // Don't send password
            const { password, ...safeUser } = user;
            res.json({ success: true, user: safeUser });
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/user/email/:email', async (req, res) => {
    try {
        const user = await getUserByEmail(req.params.email);
        if (user) {
            const { password, ...safeUser } = user;
            res.json({ success: true, user: safeUser });
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Game endpoints
app.post('/api/game', async (req, res) => {
    try {
        const { playerId, gameType } = req.body; // gameType: 'computer' or 'friend'
        const vsComputer = gameType === 'computer';
        
        const game = await createGame(playerId, null, vsComputer);
        
        // If vs computer, make computer move first (random)
        if (vsComputer) {
            const computerMove = getComputerMove(game.fen);
            if (computerMove) {
                await makeMove(game.id, 'computer', computerMove, true);
            }
        }
        
        res.json({ success: true, game });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/game/friend', async (req, res) => {
    try {
        const { player1Id, player2Email } = req.body;
        
        // Find player2 by email
        const player2 = await getUserByEmail(player2Email);
        if (!player2) {
            return res.json({ success: false, error: 'Friend not found' });
        }
        
        const game = await createGame(player1Id, player2.id, false);
        res.json({ success: true, game });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/game/:id', async (req, res) => {
    try {
        const games = await getGames();
        const game = games[req.params.id];
        if (game) {
            res.json({ success: true, game });
        } else {
            res.status(404).json({ success: false, error: 'Game not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/game/:id/move', async (req, res) => {
    try {
        const { playerId, move } = req.body;
        const result = await makeMove(req.params.id, playerId, move, false);
        
        // If vs computer and game not over, make computer move
        if (result.success && result.game && result.game.vs_computer && !result.is_game_over) {
            setTimeout(async () => {
                const games = await getGames();
                const currentGame = games[req.params.id];
                
                if (currentGame && currentGame.status === 'active') {
                    const computerMove = getComputerMove(currentGame.fen);
                    if (computerMove) {
                        await makeMove(req.params.id, 'computer', computerMove, true);
                    }
                }
            }, 1000);
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/game/:id/join', async (req, res) => {
    try {
        const { playerId } = req.body;
        const games = await getGames();
        const game = games[req.params.id];
        
        if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
        if (game.player2) return res.status(400).json({ success: false, error: 'Game full' });
        if (game.vs_computer) return res.status(400).json({ success: false, error: 'This is a computer game' });
        
        game.player2 = playerId;
        game.status = 'active';
        await saveGames(games);
        
        res.json({ success: true, game });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const users = await getUsers();
        const leaderboard = Object.values(users)
            .filter(user => user.games_played > 0)
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 20)
            .map(user => ({
                username: user.username,
                email: user.email,
                balance: user.balance,
                games_won: user.games_won,
                vs_computer_wins: user.vs_computer_wins || 0,
                total_earned: user.total_earned
            }));
        
        res.json({ success: true, leaderboard });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
        console.log(`🤖 Bot is active!`);
        console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
        console.log(`💰 Bonus: ${INITIAL_BALANCE} birr`);
        console.log(`🏆 Win Reward: ${WIN_REWARD} birr`);
        console.log(`📱 Mobile-friendly Chess App`);
        console.log(`\n✅ Features:`);
        console.log(`   • Email/Password Registration`);
        console.log(`   • Play vs Computer`);
        console.log(`   • Play vs Friends`);
        console.log(`   • Earn Money`);
    });
}

start().catch(console.error);
