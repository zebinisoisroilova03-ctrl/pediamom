/**
 * PediaMom — Scheduled Notification Functions
 *
 * Sends Telegram reminders for:
 *  - Medicine & supplement doses (hourly)
 *  - Water intake (hourly)
 *  - Vaccine schedule (daily)
 *  - Doctor appointments (daily)
 *  - New knowledge-base articles (every 30 min)
 *
 * Deploy: firebase deploy --only functions
 * Set token: firebase functions:config:set telegram.bot_token="TOKEN"
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { sendMessage } = require('../services/TelegramNotifier');

const db = admin.firestore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns dose hours for a given timesPerDay value.
 * @param {number} timesPerDay
 * @returns {number[]}
 */
function getScheduledHours(timesPerDay) {
    switch (timesPerDay) {
        case 1: return [8];
        case 2: return [8, 20];
        case 3: return [8, 13, 20];
        default:
            if (timesPerDay >= 4) {
                // Distribute evenly across 8–20 (12-hour window)
                const hours = [];
                const step = 12 / (timesPerDay - 1);
                for (let i = 0; i < timesPerDay; i++) {
                    hours.push(Math.round(8 + step * i));
                }
                return hours;
            }
            console.warn(`getScheduledHours: unexpected timesPerDay=${timesPerDay}`);
            return [8];
    }
}

/**
 * Glasses per hour = floor((liters * 4) / activeHours)
 * @param {number} dailyLiters
 * @param {number} startHour
 * @param {number} endHour
 * @returns {number}
 */
function calculateGlassesPerHour(dailyLiters, startHour, endHour) {
    const activeHours = endHour - startHour;
    if (activeHours <= 0) return 0;
    return Math.floor((dailyLiters * 4) / activeHours);
}

/**
 * Get user's Telegram chat ID from Firestore.
 * Returns null if not set.
 */
async function getTelegramChatId(userId) {
    try {
        const snap = await db.collection('users').doc(userId).get();
        return snap.exists ? (snap.data().telegramChatId || null) : null;
    } catch (_) {
        return null;
    }
}

// ─── Vaccine Schedule ─────────────────────────────────────────────────────────

const VACCINE_SCHEDULE = [
    { ageMonths: 0,  vaccines: ['BCG', 'HepB'] },
    { ageMonths: 2,  vaccines: ['DTP', 'Hib', 'IPV', 'HepB', 'PCV'] },
    { ageMonths: 3,  vaccines: ['DTP', 'Hib', 'IPV'] },
    { ageMonths: 4,  vaccines: ['DTP', 'Hib', 'IPV', 'PCV'] },
    { ageMonths: 6,  vaccines: ['DTP', 'Hib', 'HepB', 'OPV'] },
    { ageMonths: 12, vaccines: ['MMR', 'Varicella', 'PCV'] },
    { ageMonths: 18, vaccines: ['DTP booster', 'OPV'] },
    { ageMonths: 72, vaccines: ['DTP', 'OPV', 'MMR'] },
];

/**
 * Add months to a date (calendar-month aware).
 */
function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

/**
 * Format date as "Month Day, Year" for messages.
 */
function formatDate(date) {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ─── Hourly Reminders ─────────────────────────────────────────────────────────

exports.hourlyReminders = onSchedule('every 1 hours', async () => {
    // UTC+5 offset: current hour in Tashkent time
    const nowUTC = new Date();
    const currentHour = (nowUTC.getUTCHours() + 5) % 24;

    // ── Medicine reminders ──
    try {
        const medsSnap = await db.collection('medicine_list').get();
        for (const medDoc of medsSnap.docs) {
            const med = medDoc.data();
            const scheduledHours = getScheduledHours(med.timesPerDay || 1);
            if (!scheduledHours.includes(currentHour)) continue;

            const chatId = await getTelegramChatId(med.parentId);
            if (!chatId) continue;

            // Get child name
            let childName = 'your child';
            try {
                const childSnap = await db.collection('children').doc(med.childId).get();
                if (childSnap.exists) childName = childSnap.data().name || childName;
            } catch (_) {}

            try {
                await sendMessage(chatId,
                    `💊 Time to give <b>${childName}</b> their <b>${med.medicineName}</b> (${med.dosage})`
                );
            } catch (e) {
                console.error(`Medicine reminder failed for user ${med.parentId}:`, e.message);
            }
        }
    } catch (e) {
        console.error('Medicine reminders error:', e);
    }

    // ── Supplement reminders ──
    try {
        const suppSnap = await db.collection('supplements_list').get();
        for (const suppDoc of suppSnap.docs) {
            const supp = suppDoc.data();
            const scheduledHours = getScheduledHours(supp.timesPerDay || 1);
            if (!scheduledHours.includes(currentHour)) continue;

            const chatId = await getTelegramChatId(supp.userId || supp.parentId);
            if (!chatId) continue;

            try {
                await sendMessage(chatId,
                    `🌿 Time to take your <b>${supp.name || supp.supplementName}</b> (${supp.dosage})`
                );
            } catch (e) {
                console.error(`Supplement reminder failed:`, e.message);
            }
        }
    } catch (e) {
        console.error('Supplement reminders error:', e);
    }

    // ── Water intake reminders ──
    try {
        const waterSnap = await db.collection('water_intake').get();
        for (const waterDoc of waterSnap.docs) {
            const w = waterDoc.data();
            if (currentHour < w.startHour || currentHour > w.endHour) continue;

            const chatId = await getTelegramChatId(w.userId);
            if (!chatId) continue;

            const glasses = calculateGlassesPerHour(w.dailyLiters, w.startHour, w.endHour);

            try {
                await sendMessage(chatId,
                    `💧 Time to drink water! You should drink <b>${glasses}</b> glasses per hour to reach your <b>${w.dailyLiters}L</b> daily goal`
                );
            } catch (e) {
                console.error(`Water reminder failed for user ${w.userId}:`, e.message);
            }
        }
    } catch (e) {
        console.error('Water reminders error:', e);
    }
});

// ─── Daily Reminders ──────────────────────────────────────────────────────────

exports.dailyReminders = onSchedule('every day 03:00', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const in2Days = new Date(today);
    in2Days.setDate(in2Days.getDate() + 2);
    const in2DaysStr = in2Days.toISOString().split('T')[0];

    // ── Vaccine reminders ──
    try {
        const childrenSnap = await db.collection('children').get();
        for (const childDoc of childrenSnap.docs) {
            const child = childDoc.data();
            if (!child.birthDate) continue;

            const chatId = await getTelegramChatId(child.parentId);
            if (!chatId) continue;

            const birthDate = new Date(child.birthDate);

            for (const milestone of VACCINE_SCHEDULE) {
                const dueDate = addMonths(birthDate, milestone.ageMonths);
                const dueDateStr = dueDate.toISOString().split('T')[0];

                for (const vaccine of milestone.vaccines) {
                    try {
                        if (dueDateStr === todayStr) {
                            await sendMessage(chatId,
                                `💉 <b>${child.name}</b> is due for <b>${vaccine}</b> vaccination today!`
                            );
                        } else if (dueDateStr === in2DaysStr) {
                            await sendMessage(chatId,
                                `💉 <b>${child.name}</b>'s <b>${vaccine}</b> vaccination is in 2 days`
                            );
                        }
                    } catch (e) {
                        console.error(`Vaccine reminder failed:`, e.message);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Vaccine reminders error:', e);
    }

    // ── Appointment reminders ──
    try {
        const apptSnap = await db.collection('appointments').get();
        for (const apptDoc of apptSnap.docs) {
            const appt = apptDoc.data();
            if (!appt.appointmentDate) continue;

            const chatId = await getTelegramChatId(appt.userId);
            if (!chatId) continue;

            try {
                if (appt.appointmentDate === todayStr) {
                    await sendMessage(chatId, `🏥 Today is your doctor appointment day!`);
                } else if (appt.appointmentDate === in2DaysStr) {
                    await sendMessage(chatId,
                        `🏥 Your doctor appointment is in 2 days (${formatDate(in2Days)})`
                    );
                }
            } catch (e) {
                console.error(`Appointment reminder failed for user ${appt.userId}:`, e.message);
            }
        }
    } catch (e) {
        console.error('Appointment reminders error:', e);
    }
});

// ─── Article Notifications ────────────────────────────────────────────────────

exports.articleNotifications = onSchedule('every 30 minutes', async () => {
    try {
        // Find unnotified articles
        const articlesSnap = await db.collection('knowledge_base')
            .where('notified', '==', false)
            .get();

        // Also catch articles without the notified field
        const allArticlesSnap = await db.collection('knowledge_base').get();
        const unnotified = allArticlesSnap.docs.filter(d => !d.data().notified);

        const toProcess = unnotified.length > 0 ? unnotified : articlesSnap.docs;
        if (toProcess.length === 0) return;

        // Get all users with a Telegram chat ID
        const usersSnap = await db.collection('users')
            .where('telegramChatId', '!=', '')
            .get();

        const chatIds = usersSnap.docs
            .map(d => d.data().telegramChatId)
            .filter(Boolean);

        for (const articleDoc of toProcess) {
            const article = articleDoc.data();

            for (const chatId of chatIds) {
                try {
                    await sendMessage(chatId,
                        `📚 New article: <b>${article.title}</b> in <i>${article.category}</i>`
                    );
                } catch (e) {
                    console.error(`Article notification failed for chatId ${chatId}:`, e.message);
                }
            }

            // Mark as notified
            try {
                await db.collection('knowledge_base').doc(articleDoc.id).update({ notified: true });
            } catch (e) {
                console.error(`Failed to mark article ${articleDoc.id} as notified:`, e.message);
            }
        }
    } catch (e) {
        console.error('Article notifications error:', e);
    }
});

// Export helpers for testing
module.exports = Object.assign(module.exports, {
    getScheduledHours,
    calculateGlassesPerHour,
    VACCINE_SCHEDULE
});
