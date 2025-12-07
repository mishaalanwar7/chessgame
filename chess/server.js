// server.js
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'chess-master-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/chess-game', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('MongoDB connection error:', err);
    // Fallback to in-memory storage if MongoDB fails
    console.log('Using in-memory storage');
});

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    rating: { type: Number, default: 1500 },
    gamesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Game Schema
const gameSchema = new mongoose.Schema({
    whitePlayer: { type: String, required: true },
    blackPlayer: { type: String, required: true },
    timeControl: { type: String, default: '10+0' },
    status: { type: String, default: 'waiting' }, // waiting, active, finished
    moves: { type: Array, default: [] },
    result: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const Game = mongoose.model('Game', gameSchema);

// In-memory storage fallback
let users = [];
let games = [];

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Routes

// Register new user
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Validation
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        if (username.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        // Check if user already exists
        let existingUser;
        try {
            existingUser = await User.findOne({ $or: [{ username }, { email }] });
        } catch (dbError) {
            // Fallback to in-memory check
            existingUser = users.find(u => u.username === username || u.email === email);
        }
        
        if (existingUser) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create new user
        const newUser = {
            username,
            email,
            password: hashedPassword,
            rating: 1500,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            createdAt: new Date()
        };
        
        try {
            // Try to save to MongoDB
            const user = new User(newUser);
            await user.save();
        } catch (dbError) {
            // Fallback to in-memory storage
            users.push(newUser);
        }
        
        // Create JWT token
        const token = jwt.sign(
            { username: newUser.username, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.status(201).json({
            message: 'User registered successfully',
            user: {
                username: newUser.username,
                email: newUser.email,
                rating: newUser.rating
            },
            token
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// Login user
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Validation
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        // Find user
        let user;
        try {
            user = await User.findOne({ username });
        } catch (dbError) {
            // Fallback to in-memory check
            user = users.find(u => u.username === username);
        }
        
        if (!user) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }
        
        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }
        
        // Create JWT token
        const token = jwt.sign(
            { username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            message: 'Login successful',
            user: {
                username: user.username,
                email: user.email,
                rating: user.rating,
                gamesPlayed: user.gamesPlayed,
                wins: user.wins,
                losses: user.losses,
                draws: user.draws
            },
            token
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Get user profile
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const username = req.user.username;
        
        let user;
        try {
            user = await User.findOne({ username });
        } catch (dbError) {
            user = users.find(u => u.username === username);
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            username: user.username,
            email: user.email,
            rating: user.rating,
            gamesPlayed: user.gamesPlayed,
            wins: user.wins,
            losses: user.losses,
            draws: user.draws
        });
        
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create new game
app.post('/api/games', authenticateToken, async (req, res) => {
    try {
        const { timeControl, gameMode } = req.body;
        const username = req.user.username;
        
        const newGame = {
            whitePlayer: username,
            blackPlayer: gameMode === 'computer' ? 'Computer' : 'Waiting...',
            timeControl: timeControl || '10+0',
            status: gameMode === 'computer' ? 'active' : 'waiting',
            moves: [],
            createdAt: new Date()
        };
        
        try {
            const game = new Game(newGame);
            await game.save();
        } catch (dbError) {
            games.push(newGame);
        }
        
        res.status(201).json({
            message: 'Game created successfully',
            game: newGame
        });
        
    } catch (error) {
        console.error('Create game error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get available games
app.get('/api/games', async (req, res) => {
    try {
        let availableGames;
        try {
            availableGames = await Game.find({ status: { $in: ['waiting', 'active'] } })
                .sort({ createdAt: -1 })
                .limit(20);
        } catch (dbError) {
            availableGames = games.filter(g => g.status === 'waiting' || g.status === 'active')
                .slice(0, 20);
        }
        
        res.json(availableGames);
        
    } catch (error) {
        console.error('Get games error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Join game
app.put('/api/games/:id/join', authenticateToken, async (req, res) => {
    try {
        const gameId = req.params.id;
        const username = req.user.username;
        
        let game;
        try {
            game = await Game.findById(gameId);
        } catch (dbError) {
            game = games.find(g => g.id === gameId);
        }
        
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        if (game.status !== 'waiting') {
            return res.status(400).json({ error: 'Game is not available' });
        }
        
        if (game.whitePlayer === username) {
            return res.status(400).json({ error: 'Cannot join your own game' });
        }
        
        game.blackPlayer = username;
        game.status = 'active';
        
        try {
            await game.save();
        } catch (dbError) {
            // Update in-memory
            const index = games.findIndex(g => g.id === gameId);
            if (index !== -1) {
                games[index] = game;
            }
        }
        
        res.json({
            message: 'Joined game successfully',
            game
        });
        
    } catch (error) {
        console.error('Join game error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update the server to also serve static files
app.use(express.static('public'));

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API Endpoints:`);
    console.log(`  POST   /api/register`);
    console.log(`  POST   /api/login`);
    console.log(`  GET    /api/profile (requires auth)`);
    console.log(`  POST   /api/games (requires auth)`);
    console.log(`  GET    /api/games`);
    console.log(`  PUT    /api/games/:id/join (requires auth)`);
});
