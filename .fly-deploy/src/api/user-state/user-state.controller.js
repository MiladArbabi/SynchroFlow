"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserMode = exports.getUserState = void 0;
const user_state_service_1 = require("../../services/user-state.service");
const getUserState = async (req, res) => {
    try {
        const userId = req.user?.userId; // Assuming JWT middleware sets this
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const userState = await user_state_service_1.UserStateService.getUserState(userId);
        return res.status(200).json(userState);
    }
    catch (error) {
        console.error('Error getting user state:', error);
        return res.status(500).json({ error: 'Failed to get user state' });
    }
};
exports.getUserState = getUserState;
const updateUserMode = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { mode } = req.body;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!mode || !['survival', 'growth', 'architect'].includes(mode)) {
            return res.status(400).json({ error: 'Invalid mode' });
        }
        await user_state_service_1.UserStateService.updatePreferredMode(userId, mode);
        return res.status(200).json({ message: 'Mode updated successfully' });
    }
    catch (error) {
        console.error('Error updating user mode:', error);
        return res.status(500).json({ error: 'Failed to update user mode' });
    }
};
exports.updateUserMode = updateUserMode;
