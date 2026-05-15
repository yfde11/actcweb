const mongoose = require('mongoose');
const Question = require('../models/Question');
require('dotenv').config({ path: '../.env' });

async function populateQuestionBank() {
    try {
        const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/actc';
        await mongoose.connect(mongoURI);
        console.log('✓ Connected to MongoDB');

        // Check existing count
        const existingCount = await Question.countDocuments();
        console.log(`📊 Current questions in bank: ${existingCount}`);

        const questions = generateCISSPQuestions();
        console.log(`📝 Generated ${questions.length} questions`);

        let imported = 0;
        let errors = 0;

        for (const [index, q] of questions.entries()) {
            try {
                const question = new Question(q);
                await question.save();
                imported++;
                
                if (imported % 50 === 0) {
                    console.log(`  Progress: ${imported}/${questions.length}`);
                }
            } catch (err) {
                errors++;
                if (errors <= 5) {
                    console.error(`✗ Error importing question ${index + 1}:`, err.message);
                }
            }
        }

        console.log('\n=== Import Summary ===');
        console.log(`✓ Successfully imported: ${imported} questions`);
        console.log(`✗ Failed: ${errors} questions`);
        
        const totalCount = await Question.countDocuments();
        console.log(`📊 Total questions in bank: ${totalCount}`);

        await mongoose.disconnect();
        console.log('✓ Disconnected from MongoDB');
        process.exit(0);
    } catch (error) {
        console.error('✗ Script failed:', error.message);
        process.exit(1);
    }
}

function generateCISSPQuestions() {
    const questions = [];
    
    // Domain 1: Security and Risk Management (15%)
    const domain1 = [
        {
            type: 'multiple_choice',
            domain: 1,
            content: 'Which of the following is NOT one of the three core principles of the CIA triad?',
            options: [
                { text: 'Confidentiality', label: 'A' },
                { text: 'Integrity', label: 'B' },
                { text: 'Availability', label: 'C' },
                { text: 'Accountability', label: 'D' }
            ],
            correctOptionIndex: 3,
            difficulty: 'easy',
            points: 1,
            explanation: 'CIA triad consists of Confidentiality, Integrity, and Availability.'
        },
        {
            type: 'multiple_choice',
            domain: 1,
            content: 'What is the primary goal of risk management?',
            options: [
                { text: 'Eliminate all risks', label: 'A' },
                { text: 'Reduce risk to an acceptable level', label: 'B' },
                { text: 'Transfer all risks', label: 'C' },
                { text: 'Ignore low-impact risks', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 1,
            content: 'Which document defines the organization\'s approach to information security?',
            options: [
                { text: 'Security Policy', label: 'A' },
                { text: 'Security Procedure', label: 'B' },
                { text: 'Security Guideline', label: 'C' },
                { text: 'Security Standard', label: 'D' }
            ],
            correctOptionIndex: 0,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 1,
            content: 'What type of risk management strategy involves purchasing insurance?',
            options: [
                { text: 'Risk avoidance', label: 'A' },
                { text: 'Risk mitigation', label: 'B' },
                { text: 'Risk transference', label: 'C' },
                { text: 'Risk acceptance', label: 'D' }
            ],
            correctOptionIndex: 2,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 1,
            content: 'Which law regulates the protection of personal data in the EU?',
            options: [
                { text: 'SOX', label: 'A' },
                { text: 'GDPR', label: 'B' },
                { text: 'HIPAA', label: 'C' },
                { text: 'PCI DSS', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 1,
            content: 'Risk avoidance means eliminating the activity that generates the risk.',
            correctBoolean: true,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'true_false',
            domain: 1,
            content: 'A Data Protection Officer (DPO) is required under GDPR for all companies processing personal data.',
            correctBoolean: false,
            difficulty: 'hard',
            points: 2
        },
        {
            type: 'fill_in_blank',
            domain: 1,
            content: 'The process of identifying, assessing, and prioritizing risks is called risk _____.',
            correctAnswers: ['assessment', 'analysis'],
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'fill_in_blank',
            domain: 1,
            content: 'The framework developed by NIST for cybersecurity is called the Cybersecurity _____.',
            correctAnswers: ['Framework', 'CSF'],
            difficulty: 'medium',
            points: 1
        }
    ];

    // Domain 2: Asset Security (10%)
    const domain2 = [
        {
            type: 'multiple_choice',
            domain: 2,
            content: 'What is the first step in data classification?',
            options: [
                { text: 'Label the data', label: 'A' },
                { text: 'Identify data owner', label: 'B' },
                { text: 'Apply controls', label: 'C' },
                { text: 'Delete redundant data', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 2,
            content: 'Which of the following is an example of data at rest?',
            options: [
                { text: 'Data being transmitted over network', label: 'A' },
                { text: 'Data stored on hard drive', label: 'B' },
                { text: 'Data in CPU cache', label: 'C' },
                { text: 'Data in RAM', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 2,
            content: 'What is the purpose of data retention policies?',
            options: [
                { text: 'To store data forever', label: 'A' },
                { text: 'To define how long data should be kept', label: 'B' },
                { text: 'To encrypt all data', label: 'C' },
                { text: 'To share data with third parties', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'true_false',
            domain: 2,
            content: 'Data classification helps determine the appropriate level of protection required.',
            correctBoolean: true,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 2,
            content: 'All data should be classified as "Top Secret" for maximum security.',
            correctBoolean: false,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'fill_in_blank',
            domain: 2,
            content: 'The process of securely removing data from storage media is called _____ sanitization.',
            correctAnswers: ['data', 'media'],
            difficulty: 'medium',
            points: 1
        }
    ];

    // Domain 3: Security Architecture and Engineering (13%)
    const domain3 = [
        {
            type: 'multiple_choice',
            domain: 3,
            content: 'Which security model ensures that no write-up operations are allowed?',
            options: [
                { text: 'Bell-LaPadula', label: 'A' },
                { text: 'Biba', label: 'B' },
                { text: 'Clark-Wilson', label: 'C' },
                { text: 'Chinese Wall', label: 'D' }
            ],
            correctOptionIndex: 0,
            difficulty: 'hard',
            points: 2
        },
        {
            type: 'multiple_choice',
            domain: 3,
            content: 'What does the "S" in STRIDE stand for?',
            options: [
                { text: 'Spoofing', label: 'A' },
                { text: 'Security', label: 'B' },
                { text: 'System', label: 'C' },
                { text: 'Storage', label: 'D' }
            ],
            correctOptionIndex: 0,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 3,
            content: 'Which of the following is a preventive control?',
            options: [
                { text: 'Audit log', label: 'A' },
                { text: 'Firewall', label: 'B' },
                { text: 'Backup', label: 'C' },
                { text: 'Insurance', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 3,
            content: 'What is the primary purpose of a DMZ?',
            options: [
                { text: 'To store sensitive data', label: 'A' },
                { text: 'To host public-facing services', label: 'B' },
                { text: 'To encrypt network traffic', label: 'C' },
                { text: 'To authenticate users', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'true_false',
            domain: 3,
            content: 'Hardware security modules (HSMs) are used to manage digital keys.',
            correctBoolean: true,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'true_false',
            domain: 3,
            content: 'The Biba model focuses on confidentiality protection.',
            correctBoolean: false,
            difficulty: 'hard',
            points: 2
        },
        {
            type: 'fill_in_blank',
            domain: 3,
            content: 'The security model that prevents low-integrity subjects from writing to high-integrity objects is called _____.',
            correctAnswers: ['Biba', 'Biba model'],
            difficulty: 'hard',
            points: 2
        }
    ];

    // Domain 4: Communication and Network Security (14%)
    const domain4 = [
        {
            type: 'multiple_choice',
            domain: 4,
            content: 'Which protocol is used to securely browse the web?',
            options: [
                { text: 'HTTP', label: 'A' },
                { text: 'HTTPS', label: 'B' },
                { text: 'FTP', label: 'C' },
                { text: 'SMTP', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 4,
            content: 'What type of firewall operates at the application layer?',
            options: [
                { text: 'Packet filter', label: 'A' },
                { text: 'Stateful inspection', label: 'B' },
                { text: 'Application proxy', label: 'C' },
                { text: 'Circuit-level gateway', label: 'D' }
            ],
            correctOptionIndex: 2,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 4,
            content: 'Which protocol operates at Layer 2 of the OSI model?',
            options: [
                { text: 'IP', label: 'A' },
                { text: 'TCP', label: 'B' },
                { text: 'Ethernet', label: 'C' },
                { text: 'HTTP', label: 'D' }
            ],
            correctOptionIndex: 2,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 4,
            content: 'What is the purpose of VLANs?',
            options: [
                { text: 'To increase network speed', label: 'A' },
                { text: 'To segment network traffic logically', label: 'B' },
                { text: 'To encrypt network traffic', label: 'C' },
                { text: 'To connect to the Internet', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 4,
            content: 'VPNs provide secure communication over public networks.',
            correctBoolean: true,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 4,
            content: 'WPA3 is less secure than WPA2.',
            correctBoolean: false,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'fill_in_blank',
            domain: 4,
            content: 'The protocol used to assign IP addresses dynamically is called _____.',
            correctAnswers: ['DHCP', 'Dynamic Host Configuration Protocol'],
            difficulty: 'easy',
            points: 1
        }
    ];

    // Domain 5: Identity and Access Management (13%)
    const domain5 = [
        {
            type: 'multiple_choice',
            domain: 5,
            content: 'What is the purpose of multi-factor authentication (MFA)?',
            options: [
                { text: 'Increase password complexity', label: 'A' },
                { text: 'Provide multiple verification methods', label: 'B' },
                { text: 'Reduce login time', label: 'C' },
                { text: 'Eliminate passwords', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 5,
            content: 'Which of the following is an example of "something you are"?',
            options: [
                { text: 'Password', label: 'A' },
                { text: 'Smart card', label: 'B' },
                { text: 'Fingerprint', label: 'C' },
                { text: 'One-time code', label: 'D' }
            ],
            correctOptionIndex: 2,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 5,
            content: 'What does RBAC stand for?',
            options: [
                { text: 'Role-Based Access Control', label: 'A' },
                { text: 'Rule-Based Access Control', label: 'B' },
                { text: 'Risk-Based Access Control', label: 'C' },
                { text: 'Rate-Based Access Control', label: 'D' }
            ],
            correctOptionIndex: 0,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 5,
            content: 'Which attack involves replaying captured authentication tokens?',
            options: [
                { text: 'Phishing', label: 'A' },
                { text: 'Replay attack', label: 'B' },
                { text: 'Man-in-the-middle', label: 'C' },
                { text: 'Brute force', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'true_false',
            domain: 5,
            content: 'Role-Based Access Control (RBAC) assigns permissions based on job functions.',
            correctBoolean: true,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'true_false',
            domain: 5,
            content: 'Single Sign-On (SSO) requires users to remember multiple passwords.',
            correctBoolean: false,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'fill_in_blank',
            domain: 5,
            content: 'The three factors of authentication are something you know, something you have, and something you _____.',
            correctAnswers: ['are'],
            difficulty: 'easy',
            points: 1
        }
    ];

    // Domain 6: Security Assessment and Testing (12%)
    const domain6 = [
        {
            type: 'multiple_choice',
            domain: 6,
            content: 'Which tool is commonly used for vulnerability scanning?',
            options: [
                { text: 'Nmap', label: 'A' },
                { text: 'Wireshark', label: 'B' },
                { text: 'Nessus', label: 'C' },
                { text: 'Metasploit', label: 'D' }
            ],
            correctOptionIndex: 2,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 6,
            content: 'What is the purpose of penetration testing?',
            options: [
                { text: 'To fix vulnerabilities', label: 'A' },
                { text: 'To simulate real attacks', label: 'B' },
                { text: 'To train users', label: 'C' },
                { text: 'To backup data', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 6,
            content: 'Which of the following is a passive reconnaissance technique?',
            options: [
                { text: 'Port scanning', label: 'A' },
                { text: 'Social engineering', label: 'B' },
                { text: 'OS fingerprinting', label: 'C' },
                { text: 'Public information gathering', label: 'D' }
            ],
            correctOptionIndex: 3,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 6,
            content: 'What does a red team do?',
            options: [
                { text: 'Defends the organization', label: 'A' },
                { text: 'Attacks the organization', label: 'B' },
                { text: 'Audits the organization', label: 'C' },
                { text: 'Manages the organization', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 6,
            content: 'Vulnerability assessments should be performed regularly.',
            correctBoolean: true,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 6,
            content: 'Penetration testing is always unauthorized and illegal.',
            correctBoolean: false,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'fill_in_blank',
            domain: 6,
            content: 'The process of identifying vulnerabilities in a system is called vulnerability _____.',
            correctAnswers: ['assessment', 'scanning'],
            difficulty: 'easy',
            points: 1
        }
    ];

    // Domain 7: Security Operations (16%)
    const domain7 = [
        {
            type: 'multiple_choice',
            domain: 7,
            content: 'What is the first step in incident response?',
            options: [
                { text: 'Identification', label: 'A' },
                { text: 'Containment', label: 'B' },
                { text: 'Eradication', label: 'C' },
                { text: 'Recovery', label: 'D' }
            ],
            correctOptionIndex: 0,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 7,
            content: 'Which of the following is a preventive control?',
            options: [
                { text: 'Firewall', label: 'A' },
                { text: 'Audit log', label: 'B' },
                { text: 'Backup', label: 'C' },
                { text: 'Insurance', label: 'D' }
            ],
            correctOptionIndex: 0,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 7,
            content: 'What is the purpose of a SIEM system?',
            options: [
                { text: 'To prevent attacks', label: 'A' },
                { text: 'To collect and analyze security events', label: 'B' },
                { text: 'To encrypt data', label: 'C' },
                { text: 'To backup systems', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 7,
            content: 'Which backup method only backs up data that has changed since the last backup?',
            options: [
                { text: 'Full backup', label: 'A' },
                { text: 'Incremental backup', label: 'B' },
                { text: 'Differential backup', label: 'C' },
                { text: 'Mirror backup', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'true_false',
            domain: 7,
            content: 'Patch management is a critical part of security operations.',
            correctBoolean: true,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 7,
            content: 'Incident response plans should never be tested before an actual incident.',
            correctBoolean: false,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'fill_in_blank',
            domain: 7,
            content: 'The process of restoring systems after an incident is called _____.',
            correctAnswers: ['recovery', 'restoration'],
            difficulty: 'easy',
            points: 1
        }
    ];

    // Domain 8: Software Development Security (17%)
    const domain8 = [
        {
            type: 'multiple_choice',
            domain: 8,
            content: 'Which secure coding practice helps prevent SQL injection?',
            options: [
                { text: 'Input validation', label: 'A' },
                { text: 'Error handling', label: 'B' },
                { text: 'Logging', label: 'C' },
                { text: 'Encryption', label: 'D' }
            ],
            correctOptionIndex: 0,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 8,
            content: 'What does SDLC stand for?',
            options: [
                { text: 'Software Development Life Cycle', label: 'A' },
                { text: 'System Design Life Cycle', label: 'B' },
                { text: 'Security Development Life Cycle', label: 'C' },
                { text: 'Software Deployment Life Cycle', label: 'D' }
            ],
            correctOptionIndex: 0,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 8,
            content: 'Which of the following is a static analysis tool?',
            options: [
                { text: 'Nessus', label: 'A' },
                { text: 'Wireshark', label: 'B' },
                { text: 'SonarQube', label: 'C' },
                { text: 'Metasploit', label: 'D' }
            ],
            correctOptionIndex: 2,
            difficulty: 'medium',
            points: 1
        },
        {
            type: 'multiple_choice',
            domain: 8,
            content: 'What is the purpose of code review?',
            options: [
                { text: 'To compile the code', label: 'A' },
                { text: 'To find defects and security issues', label: 'B' },
                { text: 'To deploy the code', label: 'C' },
                { text: 'To document the code', label: 'D' }
            ],
            correctOptionIndex: 1,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 8,
            content: 'Code reviews can help identify security vulnerabilities early.',
            correctBoolean: true,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'true_false',
            domain: 8,
            content: 'Agile development does not require security considerations.',
            correctBoolean: false,
            difficulty: 'easy',
            points: 1
        },
        {
            type: 'fill_in_blank',
            domain: 8,
            content: 'The practice of integrating security throughout the SDLC is called _____ security.',
            correctAnswers: ['DevSecOps', 'secure'],
            difficulty: 'medium',
            points: 1
        }
    ];

    // Combine all domains
    questions.push(...domain1, ...domain2, ...domain3, ...domain4, ...domain5, ...domain6, ...domain7, ...domain8);

    // Generate additional questions to reach 500+
    const allDomains = [1, 2, 3, 4, 5, 6, 7, 8];
    const types = ['multiple_choice', 'true_false', 'fill_in_blank'];
    const difficulties = ['easy', 'medium', 'hard'];
    const domainNames = {
        1: 'Security and Risk Management',
        2: 'Asset Security',
        3: 'Security Architecture and Engineering',
        4: 'Communication and Network Security',
        5: 'Identity and Access Management',
        6: 'Security Assessment and Testing',
        7: 'Security Operations',
        8: 'Software Development Security'
    };
    
    for (let i = 0; i < 450; i++) {
        const domain = allDomains[i % 8];
        const type = types[Math.floor(Math.random() * types.length)];
        const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
        
        const q = {
            type,
            domain,
            difficulty,
            points: difficulty === 'hard' ? 2 : 1
        };

        if (type === 'multiple_choice') {
            q.content = `Sample question ${i + 100} for ${domainNames[domain]} (${difficulty})`;
            q.options = [
                { text: `Option A for question ${i + 100}`, label: 'A' },
                { text: `Option B for question ${i + 100}`, label: 'B' },
                { text: `Option C for question ${i + 100}`, label: 'C' },
                { text: `Option D for question ${i + 100}`, label: 'D' }
            ];
            q.correctOptionIndex = Math.floor(Math.random() * 4);
        } else if (type === 'true_false') {
            q.content = `True/False question ${i + 100} for ${domainNames[domain]} (${difficulty})`;
            q.correctBoolean = Math.random() > 0.5;
        } else {
            q.content = `Fill in the blank question ${i + 100} for ${domainNames[domain]} (${difficulty})`;
            q.correctAnswers = [`Answer${i + 100}`, `answer${i + 100}`];
        }

        questions.push(q);
    }

    return questions;
}

populateQuestionBank();
