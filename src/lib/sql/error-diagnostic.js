function statementOffset(sql, statement) {
    if (!statement)
        return 0;
    const offset = sql.indexOf(statement.sql, statement.from);
    return offset < 0 ? null : offset;
}

function postgresPosition(sql, message) {
    const match = message.match(/\bLINE\s+(\d+):[^\n]*\n([ \t]*)\^/i);
    if (!match)
        return null;
    const line = Number(match[1]);
    const lines = sql.split("\n");
    if (!Number.isInteger(line) || line < 1 || line > lines.length || match[2].length >= lines[line - 1].length)
        return null;
    const from = lines.slice(0, line - 1).reduce((offset, text) => offset + text.length + 1, 0) + match[2].length;
    return { from, to: from + 1 };
}

function nearPosition(sql, message) {
    const match = message.match(/\bnear\s+(?:(["'`])([\s\S]*?)\1|([^\s:;,]+))/i);
    const token = match?.[2] || match?.[3];
    if (!token)
        return null;
    const from = sql.indexOf(token);
    if (from < 0 || sql.indexOf(token, from + token.length) >= 0)
        return null;
    return { from, to: from + token.length };
}

export function queryErrorDiagnostic({ engine, sql, documentOffset, error }) {
    const statement = error?.statement;
    const statementSql = statement?.sql || sql;
    const offset = statementOffset(sql, statement);
    if (offset == null)
        return null;
    const position = engine === "postgres"
        ? postgresPosition(statementSql, error.message)
        : nearPosition(statementSql, error.message);
    if (!position)
        return null;
    return {
        from: documentOffset + offset + position.from,
        to: documentOffset + offset + position.to,
        message: error.message,
    };
}
