import { run } from "./exec.js";

export const MYSQL_DUMP_FILTER = String.raw`
use strict;
open(my $in, "<", $ARGV[0]) or die $ARGV[0] . ": $!\n";
open(my $out, ">", $ARGV[1]) or die $ARGV[1] . ": $!\n";
chmod 0600, $ARGV[1];
my $skip = 0;
while (my $line = <$in>) {
    if (!$skip && $line =~ /^\s*SET\s+\@\@GLOBAL\.GTID_PURGED\b/i) {
        $skip = $line !~ /;/;
        next;
    }
    if (!$skip && $line =~ /^\s*SET\s+(?:\@\@SESSION\.SQL_LOG_BIN|\@MYSQLDUMP_TEMP_LOG_BIN)\b/i) {
        $skip = $line !~ /;/;
        next;
    }
    if ($skip) {
        $skip = 0 if index($line, ";") >= 0;
        next;
    }
    print $out $line;
}
`;

export async function writeFilteredMysqlDump(src, dest) {
    await run(["perl", "-e", MYSQL_DUMP_FILTER, src, dest]);
}
