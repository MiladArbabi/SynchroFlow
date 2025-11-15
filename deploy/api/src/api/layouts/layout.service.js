"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertLayout = exports.findLayout = void 0;
//packages/api/src/api/layouts/layout.service.ts
const db_1 = __importDefault(require("../../db"));
const TABLE_NAME = "user_layouts";
const findLayout = async (userId, layoutName) => {
    const result = await (0, db_1.default)(TABLE_NAME)
        .where({ user_id: userId, layout_name: layoutName })
        .first();
    return result ? result.configuration : null;
};
exports.findLayout = findLayout;
const upsertLayout = async (userId, layoutName, configuration) => {
    const data = {
        user_id: userId,
        layout_name: layoutName,
        configuration: configuration, // Knex handles JSONB serialization automatically
    };
    await (0, db_1.default)(TABLE_NAME)
        .insert(data)
        .onConflict(["user_id", "layout_name"])
        .merge();
    return configuration;
};
exports.upsertLayout = upsertLayout;
