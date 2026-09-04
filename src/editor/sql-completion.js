const COMMON_PHRASES = [
    "ALTER TABLE",
    "CREATE INDEX",
    "CREATE TABLE",
    "CREATE UNIQUE INDEX",
    "CREATE VIEW",
    "CROSS JOIN",
    "DELETE FROM",
    "DROP INDEX",
    "DROP TABLE",
    "DROP VIEW",
    "FOREIGN KEY",
    "GROUP BY",
    "IF EXISTS",
    "IF NOT EXISTS",
    "INNER JOIN",
    "INSERT INTO",
    "IS NOT NULL",
    "IS NULL",
    "LEFT JOIN",
    "LEFT OUTER JOIN",
    "NATURAL JOIN",
    "NOT BETWEEN",
    "NOT IN",
    "NOT LIKE",
    "ON DELETE",
    "ON UPDATE",
    "ORDER BY",
    "PRIMARY KEY",
    "UNION ALL",
    "WITH RECURSIVE",
];

const ENGINE_PHRASES = {
    postgres: [
        "ALTER COLUMN",
        "CREATE MATERIALIZED VIEW",
        "DISTINCT ON",
        "DO NOTHING",
        "DO UPDATE",
        "DROP MATERIALIZED VIEW",
        "FULL JOIN",
        "FULL OUTER JOIN",
        "IS DISTINCT FROM",
        "IS NOT DISTINCT FROM",
        "NULLS FIRST",
        "NULLS LAST",
        "ON CONFLICT",
        "RIGHT JOIN",
        "RIGHT OUTER JOIN",
    ],
    mysql: [
        "CHARACTER SET",
        "CREATE DATABASE",
        "DROP DATABASE",
        "INSERT IGNORE",
        "ON DUPLICATE KEY UPDATE",
        "REPLACE INTO",
        "RIGHT JOIN",
        "RIGHT OUTER JOIN",
    ],
    mariadb: [
        "CHARACTER SET",
        "CREATE DATABASE",
        "DROP DATABASE",
        "INSERT IGNORE",
        "ON DUPLICATE KEY UPDATE",
        "REPLACE INTO",
        "RIGHT JOIN",
        "RIGHT OUTER JOIN",
    ],
    sqlite: [
        "CREATE VIRTUAL TABLE",
        "DO NOTHING",
        "DO UPDATE",
        "INSERT OR IGNORE",
        "INSERT OR REPLACE",
        "IS DISTINCT FROM",
        "IS NOT DISTINCT FROM",
        "ON CONFLICT",
        "WITHOUT ROWID",
    ],
};

const phrase = (label) => ({ label, type: "keyword", boost: -0.5 });

export function sqlPhraseCompletionSource(engine) {
    const options = [...COMMON_PHRASES, ...ENGINE_PHRASES[engine]].map(phrase);
    return (context) => {
        const word = context.matchBefore(/[A-Za-z_]*/);
        if (!word || (!word.text && !context.explicit))
            return null;
        return {
            from: word.from,
            options,
            validFor: /^[A-Za-z_]*$/,
        };
    };
}
