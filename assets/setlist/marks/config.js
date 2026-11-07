/* Which marks API this page talks to: the live site uses production, while
 * local testing over plain http (Mac or iPad) uses the test stage. */
const TEST = 'https://hbxfubrzclqiz7a3eowkvwexiy0ctmxg.lambda-url.eu-north-1.on.aws';
const PROD = 'https://cj3pi6yfvpeheas6bcohjbewjm0enksm.lambda-url.eu-north-1.on.aws';

export const MARKS_API = location.protocol === 'https:' ? PROD : TEST;
