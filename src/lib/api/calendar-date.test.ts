import {expect,it} from 'vitest';
import {followingDate,selectableDate} from './calendar-date';
it('rejects future days, missing captures, earlier days and reversed endpoints',()=>{
 const dates=['2026-09-29','2026-10-03'];
 expect(selectableDate('2026-09-28','2026-10-07','','',dates)).toBe(false);
 expect(selectableDate('2026-10-01','2026-10-07','','',dates)).toBe(false);
 expect(selectableDate('2026-10-08','2026-10-07','','',['2026-10-08'])).toBe(false);
 expect(selectableDate('2026-10-03','2026-10-07','','2026-09-29',dates)).toBe(false);
 expect(selectableDate('2026-09-29','2026-10-07','2026-10-03','',dates)).toBe(false);
 expect(selectableDate('2026-10-03','2026-10-07','','',dates)).toBe(true);
 expect(selectableDate('2026-10-03','2026-10-07','','',[])).toBe(false);
 expect(selectableDate('2026-02-30','2026-10-07')).toBe(false);
});
it('converts an inclusive end day to the API exclusive boundary across months and leap years',()=>{
 expect(followingDate('2026-12-31')).toBe('2027-01-01');
 expect(followingDate('2024-02-28')).toBe('2024-02-29');
 expect(followingDate('2026-02-28')).toBe('2026-03-01');
});
