import fs from 'fs';
import path from 'path';
import { API_PREFIXES } from '@middlewares/staticClient';

/**
 * The fallback keeps API paths out of the SPA shell by prefix, and the list of
 * prefixes lives apart from where routers are mounted. `/plans` was mounted and
 * never added — nothing connected the two. This does.
 */
describe('API prefixes', () => {
    it('lists every router app.ts mounts', () => {
        const source = fs.readFileSync(path.join(__dirname, 'app.ts'), 'utf8');
        const mounted = [...source.matchAll(/app\.use\(\s*["'](\/[a-z-]+)["']/g)].map(match => match[1]);

        expect(mounted.length).toBeGreaterThan(0);
        for (const prefix of mounted) {
            expect(API_PREFIXES).toContain(prefix);
        }
    });
});
