import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { connectDB } from '@config/db';
import { logger } from '@config/logger';
import { migrateHabitModelV2 } from './scripts/migrateHabitModelV2';
import app from './app';

const PORT = process.env.PORT || 5000;

/**
 * The habit model changed shape, and a release carries its own migration: it
 * runs before the first request is accepted, so there is never a window in
 * which this code reads data written for the previous one, and never two
 * shapes of a habit to handle. It is idempotent and copies without deleting,
 * so a restart that finds nothing to do costs a single query.
 */
connectDB()
    .then(async () => {
        const report = await migrateHabitModelV2();
        if (report.habitsMigrated > 0 || report.plansBackfilled > 0) {
            logger.info(report, 'Habit model 2.0 migration complete');
        }

        app.listen(PORT, () => {
            logger.info(`Server is running on port ${PORT}`);
        });
    })
    .catch((error) => {
        logger.fatal({ err: error }, 'Server failed to start');
        process.exit(1);
    });
