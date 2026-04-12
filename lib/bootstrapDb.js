/**
 * 應用程式連上 MongoDB 後執行一次：管理員確保、舊欄位補齊、空庫時寫入範例資料。
 * 部署時無須另跑腳本；若需停用範例種子，可改為由管理後台手動建立後再移除此模組之呼叫。
 */
const User = require('../models/User');
const News = require('../models/News');
const Event = require('../models/Event');
const WorkingGroup = require('../models/WorkingGroup');

async function ensureDefaultAdmin() {
    let user = await User.findOne({ username: 'admin' });
    if (!user) {
        user = new User({
            username: 'admin',
            password: 'admin',
            role: 'admin',
            isFirstLogin: false,
            emailVerified: true,
            membershipStatus: 'approved',
            canManageContent: true
        });
        await user.save();
        console.log('✅ Default admin created (username: admin)');
        return;
    }
    let dirty = false;
    if (!user.role) {
        user.role = 'admin';
        dirty = true;
    }
    if (!user.emailVerified) {
        user.emailVerified = true;
        dirty = true;
    }
    if (user.membershipStatus !== 'approved') {
        user.membershipStatus = 'approved';
        dirty = true;
    }
    if (!user.canManageContent) {
        user.canManageContent = true;
        dirty = true;
    }
    if (user.isFirstLogin !== false) {
        user.isFirstLogin = false;
        dirty = true;
    }
    if (dirty) {
        await user.save();
        console.log('✅ Admin account normalized');
    }
}

async function migrateLegacyUsers() {
    await User.updateMany({ emailVerified: { $exists: false } }, { $set: { emailVerified: true } });
    await User.updateMany(
        { role: 'admin' },
        { $set: { emailVerified: true, membershipStatus: 'approved', canManageContent: true } }
    );
}

async function seedNewsIfEmpty() {
    const n = await News.countDocuments();
    if (n > 0) return;
    await News.create({
        title: '歡迎來到 ACTC 國際資訊安全人才培育與推廣協會',
        content:
            '我們致力於推動資訊安全領域的人才培育，提供專業的培訓課程、認證考試和國際交流機會。歡迎加入我們的社群，一起為資訊安全事業努力！',
        description:
            '我們致力於推動資訊安全領域的人才培育，提供專業的培訓課程、認證考試和國際交流機會。歡迎加入我們的社群，一起為資訊安全事業努力！',
        status: 'published',
        date: new Date(),
        images: [],
        file: '',
        link: 'https://actc.org.tw',
        notifyAudience: 'none'
    });
    console.log('✅ Seed: default news');
}

async function seedEventsIfEmpty() {
    const n = await Event.countDocuments();
    if (n > 0) return;
    await Event.insertMany([
        {
            title: '資訊安全認證培訓課程',
            type: 'course',
            description:
                '為期8週的專業認證課程，涵蓋網路安全、密碼學、風險管理等核心領域。適合想要進入資訊安全領域的專業人士。',
            shortDescription: '專業認證課程，涵蓋網路安全、密碼學、風險管理等核心領域',
            date: new Date('2025-09-15T09:00:00'),
            location: '105台北市松山區復興北路57號',
            link: '',
            status: 'published',
            instructor: { name: '陳志明', title: '資安顧問', company: '資安科技公司' },
            capacity: 30,
            price: { isFree: true }
        },
        {
            title: '駭客馬拉松競賽',
            type: 'meetup',
            description:
                '24小時不間斷的資安競賽，挑戰參賽者的技術能力與創新思維。歡迎各領域專家組隊參加。',
            shortDescription: '24小時不間斷的資安競賽，挑戰技術能力與創新思維',
            date: new Date('2025-10-20T08:00:00'),
            location: '新北市板橋區文化路一段188號',
            link: 'https://discord.gg/actc-hackathon',
            status: 'registration_open',
            instructor: { name: '李美華', title: '競賽總監', company: 'ACTC協會' },
            capacity: 100,
            price: { isFree: true }
        },
        {
            title: '資安實務工作坊',
            type: 'workshop',
            description:
                '實作導向的資安技能培訓，讓學員在真實環境中學習防護技術。包含滲透測試、惡意軟體分析等主題。',
            shortDescription: '實作導向的資安技能培訓，包含滲透測試、惡意軟體分析等主題',
            date: new Date('2025-11-10T13:00:00'),
            location: '高雄市前金區中正四路211號',
            link: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_actc',
            status: 'published',
            instructor: { name: '王建國', title: '資安講師', company: '高雄科技大學' },
            capacity: 25,
            price: { isFree: false, amount: 1500, currency: 'TWD' }
        }
    ]);
    console.log('✅ Seed: default events');
}

async function seedWorkingGroupsIfEmpty() {
    const n = await WorkingGroup.countDocuments();
    if (n > 0) return;
    await WorkingGroup.insertMany([
        {
            code: 'wg1',
            title: 'WG1 產學讀書會',
            subtitle: '',
            description: '促進技術交流與研究連結，建立學術與產業對話平台。',
            sortOrder: 1,
            isActive: true
        },
        {
            code: 'wg2',
            title: 'WG2 教育人培',
            subtitle: '',
            description: '發展課程體系與職能培訓機制，提升資安人才專業能力。',
            sortOrder: 2,
            isActive: true
        },
        {
            code: 'wg3',
            title: 'WG3 Gov 白帽駭客',
            subtitle: '',
            description: '推動政府合作專案，強化國家資安意識與防護能力。',
            sortOrder: 3,
            isActive: true
        },
        {
            code: 'wg4',
            title: 'WG4 國際認證培訓',
            subtitle: '',
            description:
                '聚焦產業實務與 AI 資安應用認證培訓，推動國際化認證落地與技術創新。',
            sortOrder: 4,
            isActive: true
        }
    ]);
    console.log('✅ Seed: default working groups (WG1–WG4)');
}

async function bootstrapDatabase() {
    await ensureDefaultAdmin();
    await migrateLegacyUsers();
    await seedNewsIfEmpty();
    await seedEventsIfEmpty();
    await seedWorkingGroupsIfEmpty();
}

module.exports = { bootstrapDatabase };
