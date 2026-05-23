// ============= CONFIG =============
const GRID_SIZE = 9;
const STORAGE_KEY = 'blockBlastHighScore';
const CLEAR_ANIMATION_MS = 180;
const COMBO_RESET_MS = 1600;
const SLOT_COUNT = 3;
const MOBILE_DRAG_GAP = 64;
const MOBILE_DRAG_EDGE_PADDING = 12;
const DRAG_START_THRESHOLD = 10;

// ============= PIECE DEFINITIONS =============
const PIECE_TEMPLATES = [
    { name: 'square', shape: [[1, 1], [1, 1]], color: '#00ffff' },
    { name: 'line3', shape: [[1, 1, 1]], color: '#ff4d6d' },
    { name: 'line4', shape: [[1, 1, 1, 1]], color: '#00ff88' },
    { name: 'line5', shape: [[1, 1, 1, 1, 1]], color: '#ffd166' },
    { name: 't', shape: [[1, 1, 1], [0, 1, 0]], color: '#ffaa00' },
    { name: 'l', shape: [[1, 0], [1, 0], [1, 1]], color: '#ff7a00' },
    { name: 'lReverse', shape: [[0, 1], [0, 1], [1, 1]], color: '#7b2cff' },
    { name: 's', shape: [[0, 1, 1], [1, 1, 0]], color: '#00d4ff' },
    { name: 'z', shape: [[1, 1, 0], [0, 1, 1]], color: '#ff1493' }
];

// ============= DOM =============
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('score');
const highScoreDisplay = document.getElementById('highScore');
const comboItem = document.getElementById('comboItem');
const comboStreakDisplay = document.getElementById('comboStreak');

const queueContainer = document.getElementById('queueContainer');
const gridOverlay = document.getElementById('gridOverlay');
const gameOverModal = document.getElementById('gameOverModal');
const restartBtn = document.getElementById('restartBtn');
const pauseBtn = document.getElementById('pauseBtn');
const finalScoreDisplay = document.getElementById('finalScore');
const finalHighScoreDisplay = document.getElementById('finalHighScore');

// ============= STATE =============
const gameState = {
    gridSize: GRID_SIZE,
    grid: createEmptyGrid(GRID_SIZE),
    queue: [],
    bag: [],
    score: 0,
    highScore: Number(localStorage.getItem(STORAGE_KEY) || 0),
    comboStreak: 0,
    comboResetTimer: null,
    clearAnimationTimer: null,
    gameOver: false,
    paused: false,
    isDragging: false,
    isResolving: false,
    activePieceIndex: -1,
    selectedPieceIndex: -1,
    draggedPiece: null,
    dragPointerId: null,
    dragStartPoint: null,
    dragPreview: null,
    dragTarget: null,
    dragCanPlace: false,
    boardHoverTarget: null,
    boardHoverCanPlace: false,
    dragPosition: { x: 0, y: 0 },
    boardSize: 0,
    cellSize: 0,
    queuedClear: null,
    effectLayer: null
};

let canvasCssSize = 0;
let listenersBound = false;
const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

// ============= HELPERS =============

function getGridSize() {
    return gameState.gridSize;
}

function createEmptyGrid(gridSize = getGridSize()) {
    return Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
}

function cloneShape(shape) {
    return shape.map(row => [...row]);
}

function getBlockCellCount(piece) {
    return piece.shape.reduce((count, row) => count + row.filter(Boolean).length, 0);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function rebuildBag() {
    gameState.bag = shuffle([...PIECE_TEMPLATES]);
}

function drawRoundedRect(x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function cryptoRandomId() {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const buffer = new Uint32Array(1);
        window.crypto.getRandomValues(buffer);
        return buffer[0].toString(16);
    }
    return Math.floor(Math.random() * 1e9).toString(16);
}

function clearComboResetTimer() {
    if (gameState.comboResetTimer) {
        window.clearTimeout(gameState.comboResetTimer);
        gameState.comboResetTimer = null;
    }
}

function clearClearAnimationTimer() {
    if (gameState.clearAnimationTimer) {
        window.clearTimeout(gameState.clearAnimationTimer);
        gameState.clearAnimationTimer = null;
    }
}

function scheduleComboReset() {
    clearComboResetTimer();
    gameState.comboResetTimer = window.setTimeout(() => {
        gameState.comboStreak = 0;
        updateComboUI();
    }, COMBO_RESET_MS);
}

function resetCombo() {
    clearComboResetTimer();
    gameState.comboStreak = 0;
    updateComboUI();
}

function ensureEffectLayer() {
    if (gameState.effectLayer) return gameState.effectLayer;

    const layer = document.createElement('div');
    layer.className = 'board-effects';
    canvas.parentElement.appendChild(layer);
    gameState.effectLayer = layer;
    return layer;
}

function spawnClearEffects(cleared, comboMultiplier, gainedScore) {
    const layer = ensureEffectLayer();
    layer.innerHTML = '';

    const cell = gameState.cellSize;
    const boardSize = gameState.boardSize || canvasCssSize;
    const seen = new Set();
    const affectedCells = [];
    const gridSize = getGridSize();

    for (const row of cleared.rows) {
        for (let col = 0; col < gridSize; col++) {
            const key = `${row}:${col}`;
            if (seen.has(key)) continue;
            seen.add(key);
            affectedCells.push({ row, col });
        }
    }

    for (const col of cleared.cols) {
        for (let row = 0; row < gridSize; row++) {
            const key = `${row}:${col}`;
            if (seen.has(key)) continue;
            seen.add(key);
            affectedCells.push({ row, col });
        }
    }

    for (const cellPos of affectedCells) {
        const burst = document.createElement('span');
        burst.className = 'clear-burst';
        burst.style.left = `${cellPos.col * cell + cell / 2}px`;
        burst.style.top = `${cellPos.row * cell + cell / 2}px`;
        burst.style.width = `${Math.max(14, Math.floor(cell * 0.32))}px`;
        burst.style.height = burst.style.width;
        layer.appendChild(burst);
    }

    const comboText = document.createElement('div');
    comboText.className = 'floating-score floating-combo';
    comboText.textContent = `COMBO x${comboMultiplier}`;
    comboText.style.left = `${boardSize / 2}px`;
    comboText.style.top = `${Math.max(18, boardSize * 0.22)}px`;
    layer.appendChild(comboText);

    const scoreText = document.createElement('div');
    scoreText.className = 'floating-score floating-points';
    scoreText.textContent = `+${gainedScore}`;
    scoreText.style.left = `${boardSize / 2}px`;
    scoreText.style.top = `${Math.max(58, boardSize * 0.32)}px`;
    layer.appendChild(scoreText);

    window.setTimeout(() => {
        if (gameState.effectLayer === layer) {
            layer.innerHTML = '';
        }
    }, 900);
}

// ============= GAME SETUP =============

function initGame() {
    clearComboResetTimer();
    clearClearAnimationTimer();
    gameState.gridSize = GRID_SIZE;
    gameState.grid = createEmptyGrid(gameState.gridSize);
    gameState.queue = [];
    gameState.bag = [];
    gameState.score = 0;
    gameState.gameOver = false;
    gameState.paused = false;
    gameState.isDragging = false;
    gameState.isResolving = false;
    gameState.activePieceIndex = -1;
    gameState.selectedPieceIndex = -1;
    gameState.draggedPiece = null;
    gameState.dragPointerId = null;
    gameState.dragStartPoint = null;
    gameState.dragTarget = null;
    gameState.dragCanPlace = false;
    gameState.boardHoverTarget = null;
    gameState.boardHoverCanPlace = false;
    gameState.comboStreak = 0;
    gameState.queuedClear = null;
    removeDragPreview();

    rebuildBag();
    refillQueue();

    updateHighScore();
    updateUI();
    hideGameOverModal();
    updatePauseButton();
    render();
}

function refillQueue() {
    while (gameState.queue.length < SLOT_COUNT) {
        if (gameState.bag.length === 0) {
            rebuildBag();
        }

        const template = gameState.bag.pop();
        gameState.queue.push({
            id: `${template.name}-${cryptoRandomId()}`,
            name: template.name,
            shape: cloneShape(template.shape),
            color: template.color
        });
    }
}

// ============= BOARD / PIECE LOGIC =============
function getOccupiedCells(piece) {
    const cells = [];
    for (let row = 0; row < piece.shape.length; row++) {
        for (let col = 0; col < piece.shape[row].length; col++) {
            if (piece.shape[row][col]) {
                cells.push({ row, col });
            }
        }
    }
    return cells;
}

function canPlacePiece(piece, startRow, startCol, grid = gameState.grid) {
    const cells = getOccupiedCells(piece);
    const gridSize = getGridSize();

    for (const cell of cells) {
        const row = startRow + cell.row;
        const col = startCol + cell.col;

        if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
            return false;
        }

        if (grid[row][col] !== null) {
            return false;
        }
    }

    return true;
}

function findClearedLines(grid = gameState.grid) {
    const rows = [];
    const cols = [];
    const gridSize = getGridSize();

    for (let row = 0; row < gridSize; row++) {
        if (grid[row].every(Boolean)) {
            rows.push(row);
        }
    }

    for (let col = 0; col < gridSize; col++) {
        let filled = true;
        for (let row = 0; row < gridSize; row++) {
            if (!grid[row][col]) {
                filled = false;
                break;
            }
        }
        if (filled) {
            cols.push(col);
        }
    }

    return { rows, cols };
}

function applyPiece(piece, startRow, startCol) {
    const cells = getOccupiedCells(piece);

    for (const cell of cells) {
        const row = startRow + cell.row;
        const col = startCol + cell.col;
        gameState.grid[row][col] = {
            color: piece.color,
            pieceId: piece.id
        };
    }

    const cleared = findClearedLines();
    const occupiedCount = cells.length;
    const clearedCount = cleared.rows.length + cleared.cols.length;
    const hasClear = clearedCount > 0;

    if (hasClear) {
        gameState.comboStreak += 1;
        scheduleComboReset();
    } else {
        resetCombo();
    }

    const comboMultiplier = hasClear ? Math.min(5, gameState.comboStreak) : 1;
    const clearBonus = hasClear ? (clearedCount * 120 + Math.max(0, clearedCount - 1) * 80) : 0;
    const gainedScore = occupiedCount * 10 + clearBonus * comboMultiplier;

    gameState.score += gainedScore;
    gameState.highScore = Math.max(gameState.highScore, gameState.score);
    localStorage.setItem(STORAGE_KEY, String(gameState.highScore));
    updateHighScore();
    updateComboUI();

    if (hasClear) {
        gameState.isResolving = true;
        gameState.queuedClear = cleared;
        spawnClearEffects(cleared, comboMultiplier, gainedScore);
        render();

        clearClearAnimationTimer();
        gameState.clearAnimationTimer = window.setTimeout(() => {
            clearMatchedLines(cleared);
            gameState.isResolving = false;
            gameState.queuedClear = null;
            gameState.clearAnimationTimer = null;
            afterSuccessfulMove();
        }, CLEAR_ANIMATION_MS);
    } else {
        afterSuccessfulMove();
    }
}

function clearMatchedLines(cleared) {
    const gridSize = getGridSize();

    for (const row of cleared.rows) {
        for (let col = 0; col < gridSize; col++) {
            gameState.grid[row][col] = null;
        }
    }

    for (const col of cleared.cols) {
        for (let row = 0; row < gridSize; row++) {
            gameState.grid[row][col] = null;
        }
    }
}

function afterSuccessfulMove() {
    refillQueue();
    updateUI();
    render();

    if (!hasAnyValidMove()) {
        endGame();
    }
}

function hasAnyValidMove() {
    const gridSize = getGridSize();

    for (const piece of gameState.queue) {
        for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
                if (canPlacePiece(piece, row, col)) {
                    return true;
                }
            }
        }
    }
    return false;
}

// ============= INPUT / DRAG =============

function bindEventListeners() {
    if (listenersBound) return;
    listenersBound = true;

    queueContainer.querySelectorAll('.block-slot').forEach((slot, index) => {
        slot.addEventListener('pointerdown', (event) => selectPiece(event, index));
    });

    canvas.addEventListener('pointermove', onBoardPointerMove);
    canvas.addEventListener('pointerdown', onBoardPointerDown);
    canvas.addEventListener('pointerleave', clearBoardHover);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('resize', handleResize);

    restartBtn.addEventListener('click', () => {
        initGame();
    });

    pauseBtn.addEventListener('click', togglePause);
}

function selectPiece(event, pieceIndex) {
    if (gameState.gameOver || gameState.paused || gameState.isResolving) return;
    if (pieceIndex < 0 || pieceIndex >= gameState.queue.length) return;
    if (gameState.dragPointerId !== null && event.pointerId !== gameState.dragPointerId) return;

    event.preventDefault();

    const nextIndex = gameState.selectedPieceIndex === pieceIndex ? -1 : pieceIndex;
    gameState.selectedPieceIndex = nextIndex;
    gameState.activePieceIndex = nextIndex;
    gameState.draggedPiece = nextIndex === -1 ? null : {
        ...gameState.queue[nextIndex],
        shape: cloneShape(gameState.queue[nextIndex].shape)
    };
    gameState.boardHoverTarget = null;
    gameState.boardHoverCanPlace = false;
    gameState.dragTarget = null;
    gameState.dragCanPlace = false;
    gameState.dragStartPoint = { x: event.clientX, y: event.clientY };
    gameState.dragPointerId = event.pointerId;
    gameState.isDragging = false;
    if (event.currentTarget && event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    queueContainer.querySelectorAll('.block-slot').forEach((slot, index) => {
        slot.classList.toggle('dragging', index === nextIndex);
    });

    if (nextIndex === -1) {
        removeDragPreview();
    } else {
        ensureDragPreview();
    }

    updateQueueDisplay();
    render();
}

function onBoardPointerMove(event) {
    if (gameState.gameOver || gameState.paused || gameState.isResolving) return;
    if (gameState.selectedPieceIndex === -1 && !gameState.isDragging) return;

    event.preventDefault();
    updateBoardHover(event.clientX, event.clientY);
}

function onBoardPointerDown(event) {
    if (gameState.gameOver || gameState.paused || gameState.isResolving) return;
    if (gameState.selectedPieceIndex === -1 && !gameState.isDragging) return;

    event.preventDefault();
    updateBoardHover(event.clientX, event.clientY);
    attemptBoardPlacement();
}

function onPointerMove(event) {
    if (gameState.dragPointerId !== event.pointerId) return;
    if (!gameState.draggedPiece || gameState.gameOver || gameState.paused || gameState.isResolving) return;

    const startPoint = gameState.dragStartPoint;
    if (!gameState.isDragging && startPoint) {
        const dx = event.clientX - startPoint.x;
        const dy = event.clientY - startPoint.y;
        if (Math.hypot(dx, dy) >= DRAG_START_THRESHOLD) {
            gameState.isDragging = true;
            ensureDragPreview();
            updateDragPreview(event.clientX, event.clientY);
            updateBoardHover(event.clientX, event.clientY);
        }
        return;
    }

    if (!gameState.isDragging) return;
    event.preventDefault();
    updateDragPreview(event.clientX, event.clientY);
}

function onPointerUp(event) {
    if (gameState.dragPointerId !== event.pointerId) return;

    if (gameState.isDragging) {
        event.preventDefault();
        attemptDrop(event.clientX, event.clientY);
        cancelDrag();
    }

    gameState.dragPointerId = null;
    gameState.dragStartPoint = null;
}

function cancelDrag() {
    gameState.isDragging = false;
    gameState.activePieceIndex = gameState.selectedPieceIndex;
    gameState.draggedPiece = gameState.selectedPieceIndex === -1 ? null : {
        ...gameState.queue[gameState.selectedPieceIndex],
        shape: cloneShape(gameState.queue[gameState.selectedPieceIndex].shape)
    };
    gameState.dragPointerId = null;
    gameState.dragStartPoint = null;
    gameState.dragTarget = null;
    gameState.dragCanPlace = false;

    queueContainer.querySelectorAll('.block-slot').forEach((slot, index) => {
        slot.classList.toggle('dragging', index === gameState.selectedPieceIndex);
    });

    removeDragPreview();
    render();
}

function clearSelectionState() {
    gameState.selectedPieceIndex = -1;
    gameState.activePieceIndex = -1;
    gameState.draggedPiece = null;
    gameState.boardHoverTarget = null;
    gameState.boardHoverCanPlace = false;
    gameState.dragTarget = null;
    gameState.dragCanPlace = false;

    queueContainer.querySelectorAll('.block-slot').forEach((slot) => {
        slot.classList.remove('dragging');
    });

    removeDragPreview();
    updateQueueDisplay();
    render();
}

function getBoardTargetFromPointer(clientX, clientY) {
    const boardRect = canvas.getBoundingClientRect();
    const x = clientX - boardRect.left;
    const y = clientY - boardRect.top;

    if (x < 0 || y < 0 || x >= boardRect.width || y >= boardRect.height) {
        return null;
    }

    return {
        row: Math.floor(y / gameState.cellSize),
        col: Math.floor(x / gameState.cellSize)
    };
}

function updateBoardHover(clientX, clientY) {
    if (gameState.selectedPieceIndex === -1 && !gameState.isDragging) return;

    const target = getBoardTargetFromPointer(clientX, clientY);
    if (!target) {
        clearBoardHover();
        return;
    }

    const piece = gameState.draggedPiece || gameState.queue[gameState.selectedPieceIndex];
    if (!piece) return;

    const maxRow = Math.max(0, getGridSize() - piece.shape.length);
    const maxCol = Math.max(0, getGridSize() - piece.shape[0].length);
    const startRow = clamp(target.row, 0, maxRow);
    const startCol = clamp(target.col, 0, maxCol);

    gameState.boardHoverTarget = { row: startRow, col: startCol };
    gameState.boardHoverCanPlace = canPlacePiece(piece, startRow, startCol);
    gameState.dragTarget = gameState.boardHoverTarget;
    gameState.dragCanPlace = gameState.boardHoverCanPlace;
    render();
}

function clearBoardHover() {
    gameState.boardHoverTarget = null;
    gameState.boardHoverCanPlace = false;

    if (!gameState.isDragging) {
        gameState.dragTarget = null;
        gameState.dragCanPlace = false;
    }

    render();
}

function attemptBoardPlacement() {
    const pieceIndex = gameState.selectedPieceIndex;
    if (pieceIndex < 0 || pieceIndex >= gameState.queue.length) return;

    const target = gameState.boardHoverTarget;
    if (!target) return;

    const piece = gameState.queue[pieceIndex];
    if (!canPlacePiece(piece, target.row, target.col)) return;

    gameState.queue.splice(pieceIndex, 1);
    clearSelectionState();
    applyPiece(piece, target.row, target.col);
}

function attemptDrop() {
    if (!gameState.draggedPiece || gameState.gameOver || gameState.paused || gameState.isResolving) return;

    const target = gameState.dragTarget;
    if (!target) {
        return;
    }

    if (!gameState.dragCanPlace || !canPlacePiece(gameState.draggedPiece, target.row, target.col)) {
        return;
    }

    const pieceIndex = gameState.activePieceIndex;
    const piece = gameState.queue[pieceIndex];
    gameState.queue.splice(pieceIndex, 1);
    clearSelectionState();
    applyPiece(piece, target.row, target.col);
}

function ensureDragPreview() {
    if (gameState.dragPreview) return;

    const preview = document.createElement('div');
    preview.className = 'drag-preview';
    document.body.appendChild(preview);
    gameState.dragPreview = preview;
}

function removeDragPreview() {
    if (!gameState.dragPreview) return;
    gameState.dragPreview.remove();
    gameState.dragPreview = null;
}

function updateDragPreview(clientX, clientY) {
    if (!gameState.dragPreview || !gameState.draggedPiece) return;

    const boardRect = canvas.getBoundingClientRect();
    const piece = gameState.draggedPiece;
    const cellsWide = piece.shape[0].length;
    const cellsHigh = piece.shape.length;
    const gridSize = getGridSize();
    const maxTopLeftCol = Math.max(0, gridSize - cellsWide);
    const maxTopLeftRow = Math.max(0, gridSize - cellsHigh);

    const localX = clamp(clientX - boardRect.left, 0, boardRect.width);
    const localY = clamp(clientY - boardRect.top, 0, boardRect.height);

    const rawCol = Math.floor(localX / gameState.cellSize);
    const rawRow = Math.floor(localY / gameState.cellSize);
    const topLeftCol = clamp(rawCol, 0, maxTopLeftCol);
    const topLeftRow = clamp(rawRow, 0, maxTopLeftRow);

    const canPlace = canPlacePiece(piece, topLeftRow, topLeftCol);
    gameState.dragTarget = { row: topLeftRow, col: topLeftCol };
    gameState.dragCanPlace = canPlace;

    const cellPx = Math.max(12, Math.floor(gameState.cellSize - 1));
    const gap = isCoarsePointer ? Math.max(MOBILE_DRAG_GAP, Math.round(gameState.cellSize * 0.75)) : 0;
    const previewWidth = cellsWide * cellPx + Math.max(0, cellsWide - 1) * 2;
    const previewHeight = cellsHigh * cellPx + Math.max(0, cellsHigh - 1) * 2;
    const snappedX = boardRect.left + topLeftCol * gameState.cellSize;
    const snappedY = boardRect.top + topLeftRow * gameState.cellSize;
    const centeredLeft = snappedX + (gameState.cellSize - previewWidth) / 2;
    const aboveFingerTop = snappedY - previewHeight - gap;
    const belowFingerTop = snappedY + gameState.cellSize + gap;
    const minLeft = boardRect.left + MOBILE_DRAG_EDGE_PADDING;
    const maxLeft = boardRect.right - previewWidth - MOBILE_DRAG_EDGE_PADDING;
    const minTop = boardRect.top + MOBILE_DRAG_EDGE_PADDING;
    const maxTop = boardRect.bottom - previewHeight - MOBILE_DRAG_EDGE_PADDING;
    let targetLeft = clamp(centeredLeft, minLeft, maxLeft);
    let targetTop = clamp(aboveFingerTop, minTop, maxTop);

    if (isCoarsePointer && targetTop === minTop && aboveFingerTop < minTop) {
        targetTop = clamp(belowFingerTop, minTop, maxTop);
    }

    let html = `<div class="block-grid-preview" style="grid-template-columns: repeat(${cellsWide}, ${cellPx}px); gap: 2px; opacity: ${canPlace ? 0.96 : 0.5}; color: ${canPlace ? piece.color : '#666'};">`;
    for (let row = 0; row < cellsHigh; row++) {
        for (let col = 0; col < cellsWide; col++) {
            const filled = piece.shape[row][col];
            html += `<div class="block-cell-preview ${filled ? 'filled' : ''}" style="width:${cellPx}px;height:${cellPx}px;${filled ? `background:${canPlace ? piece.color : '#666'};border-color:${canPlace ? piece.color : '#666'};box-shadow:0 0 10px ${canPlace ? piece.color : 'transparent'};` : ''}"></div>`;
        }
    }
    html += '</div>';

    gameState.dragPreview.innerHTML = html;
    gameState.dragPreview.style.left = `${targetLeft}px`;
    gameState.dragPreview.style.top = `${targetTop}px`;
    gameState.dragPreview.style.opacity = canPlace ? '0.95' : '0.55';

    render();
}

// ============= UI =============

function updateUI() {
    scoreDisplay.textContent = String(gameState.score);
    highScoreDisplay.textContent = String(gameState.highScore);
    updateComboUI();
    updateQueueDisplay();
}

function updateHighScore() {
    highScoreDisplay.textContent = String(gameState.highScore);
}

function updateComboUI() {
    comboStreakDisplay.textContent = String(gameState.comboStreak);
    comboItem.classList.toggle('combo-active', gameState.comboStreak > 0);
}

function updateQueueDisplay() {
    const slots = queueContainer.querySelectorAll('.block-slot');

    slots.forEach((slot, index) => {
        slot.innerHTML = '';
        slot.classList.toggle('has-block', index < gameState.queue.length);
        slot.classList.toggle('dragging', index === gameState.selectedPieceIndex);

        if (index >= gameState.queue.length) return;

        const piece = gameState.queue[index];
        const preview = document.createElement('div');
        preview.className = 'block-preview';
        preview.style.color = piece.color;
        preview.innerHTML = createBlockGridHTML(piece);
        slot.appendChild(preview);
    });
}

function createBlockGridHTML(piece) {
    const cols = piece.shape[0].length;
    let html = `<div class="block-grid" style="grid-template-columns: repeat(${cols}, 1fr); color: ${piece.color};">`;

    for (let row = 0; row < piece.shape.length; row++) {
        for (let col = 0; col < piece.shape[row].length; col++) {
            html += `<div class="block-cell ${piece.shape[row][col] ? 'filled' : ''}"></div>`;
        }
    }

    html += '</div>';
    return html;
}

function togglePause() {
    if (gameState.gameOver) return;
    gameState.paused = !gameState.paused;
    updatePauseButton();
    render();
}

function updatePauseButton() {
    pauseBtn.textContent = gameState.paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-pressed', String(gameState.paused));
    document.body.classList.toggle('game-paused', gameState.paused);
}

function hideGameOverModal() {
    gameOverModal.classList.remove('show');
}

function showGameOverModal() {
    finalScoreDisplay.textContent = String(gameState.score);
    finalHighScoreDisplay.textContent = String(gameState.highScore);
    gameOverModal.classList.add('show');
}

// ============= GAME FLOW =============
function endGame() {
    gameState.gameOver = true;
    clearComboResetTimer();
    clearClearAnimationTimer();
    cancelDrag();
    showGameOverModal();
    render();
}

function handleResize() {
    updateCanvasSize();
    render();
}

function updateCanvasSize() {
    const board = canvas.parentElement;
    const gridSize = getGridSize();
    const rawSize = Math.min(board.clientWidth, board.clientHeight);
    const size = Math.floor(rawSize / gridSize) * gridSize;
    const dpr = window.devicePixelRatio || 1;

    canvasCssSize = size;
    gameState.boardSize = size;
    gameState.cellSize = size / gridSize;

    board.style.width = `${size}px`;
    board.style.height = `${size}px`;

    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    if (gridOverlay) {
        gridOverlay.style.backgroundSize = `${gameState.cellSize}px ${gameState.cellSize}px`;
        gridOverlay.style.backgroundPosition = '0 0';
    }

    ensureEffectLayer();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ============= RENDERING =============
function render() {
    const size = canvasCssSize || canvas.clientWidth || canvas.parentElement.clientWidth;
    const gridSize = getGridSize();
    const cell = gameState.cellSize || (size / gridSize);

    ctx.clearRect(0, 0, size, size);

    // Background
    ctx.fillStyle = '#0b1026';
    ctx.fillRect(0, 0, size, size);

    if (!isCoarsePointer) {
        const bg = ctx.createLinearGradient(0, 0, 0, size);
        bg.addColorStop(0, '#0e1430');
        bg.addColorStop(1, '#081022');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);

        const glow = ctx.createRadialGradient(size * 0.35, size * 0.25, size * 0.05, size * 0.5, size * 0.5, size * 0.8);
        glow.addColorStop(0, 'rgba(0,255,255,0.08)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, size, size);
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < gridSize; i++) {
        const pos = Math.round(i * cell);
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, size);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(size, pos);
        ctx.stroke();
    }

    // Active line clear highlight
    if (gameState.queuedClear) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        for (const row of gameState.queuedClear.rows) {
            ctx.fillRect(0, row * cell, size, cell);
        }
        for (const col of gameState.queuedClear.cols) {
            ctx.fillRect(col * cell, 0, cell, size);
        }
    }

    // Placed blocks
    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            const cellData = gameState.grid[row][col];
            if (!cellData) continue;
            drawCell(col * cell, row * cell, cell, cellData.color);
        }
    }

    const ghostPiece = gameState.isDragging
        ? gameState.draggedPiece
        : (gameState.selectedPieceIndex >= 0 ? gameState.queue[gameState.selectedPieceIndex] : null);
    const ghostTarget = gameState.isDragging ? gameState.dragTarget : gameState.boardHoverTarget;
    const ghostCanPlace = gameState.isDragging ? gameState.dragCanPlace : gameState.boardHoverCanPlace;

    if (ghostPiece && ghostTarget) {
        drawGhostPiece(ghostPiece, ghostTarget.row, ghostTarget.col, ghostCanPlace);
    }

    // Pause overlay
    if (gameState.paused && !gameState.gameOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PAUSED', size / 2, size / 2);
    }

    // Game over tint
    if (gameState.gameOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(0, 0, size, size);
    }
}

function drawCell(x, y, cell, color) {
    const padding = Math.max(1, Math.floor(cell * 0.03));
    const w = cell - padding * 2;
    const h = cell - padding * 2;
    const radius = Math.max(5, Math.floor(cell * 0.16));

    ctx.save();

    const shadow = ctx.createLinearGradient(x, y, x + cell, y + cell);
    shadow.addColorStop(0, lightenColor(color, 0.28));
    shadow.addColorStop(1, color);

    ctx.shadowColor = color;
    ctx.shadowBlur = isCoarsePointer ? 4 : 8;
    drawRoundedRect(x + padding, y + padding, w, h, radius);
    ctx.fillStyle = shadow;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    drawRoundedRect(x + padding + 2, y + padding + 2, w * 0.35, h * 0.28, radius * 0.65);
    ctx.fill();

    ctx.restore();
}

function drawGhostPiece(piece, startRow, startCol, canPlace) {
    const cell = gameState.cellSize || 0;
    if (!cell) return;

    const occupied = getOccupiedCells(piece);
    const ghostFill = canPlace ? piece.color : '#ff5c7a';
    const ghostStroke = canPlace ? 'rgba(255,255,255,0.35)' : 'rgba(255,92,122,0.65)';

    ctx.save();
    ctx.globalAlpha = canPlace ? 0.42 : 0.28;
    ctx.shadowColor = ghostFill;
    ctx.shadowBlur = canPlace ? 10 : 6;

    for (const part of occupied) {
        const x = (startCol + part.col) * cell;
        const y = (startRow + part.row) * cell;
        const padding = Math.max(2, Math.floor(cell * 0.12));
        const w = cell - padding * 2;
        const h = cell - padding * 2;
        const radius = Math.max(4, Math.floor(cell * 0.14));

        drawRoundedRect(x + padding, y + padding, w, h, radius);
        ctx.fillStyle = ghostFill;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.strokeStyle = ghostStroke;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        drawRoundedRect(x + padding + 2, y + padding + 2, w * 0.35, h * 0.28, radius * 0.7);
        ctx.fill();

        ctx.shadowBlur = canPlace ? 10 : 6;
    }

    ctx.restore();
}

function lightenColor(hex, amount) {
    const normalized = hex.replace('#', '');
    const num = parseInt(normalized, 16);
    const r = Math.min(255, Math.round(((num >> 16) & 255) + 255 * amount));
    const g = Math.min(255, Math.round(((num >> 8) & 255) + 255 * amount));
    const b = Math.min(255, Math.round((num & 255) + 255 * amount));
    return `rgb(${r}, ${g}, ${b})`;
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;

    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
        console.warn('Service worker registration failed:', error);
    });
}

// ============= BOOT =============
window.addEventListener('load', () => {
    updateCanvasSize();
    bindEventListeners();
    initGame();
    registerServiceWorker();
});
