/**
 * lunar-javascript 的最小类型声明（对应系统设计文档 4.1 的隔离层）。
 *
 * 上游包未提供 .d.ts，本文件只声明 LunarService 实际使用的 API，
 * 保持类型安全的同时避免引入不必要的外部类型依赖。
 */
declare module 'lunar-javascript' {
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    /** 0=周日 … 6=周六 */
    getWeek(): number;
    getLunar(): Lunar;
  }

  export class Lunar {
    static fromYmd(year: number, month: number, day: number): Lunar;
    /** 农历年 */
    getYear(): number;
    /** 月份：正数为正常月，负数为闰月 */
    getMonth(): number;
    /** 日 1..30 */
    getDay(): number;
    /** 月名（不含「月」字），如 正 / 八 / 冬 / 腊 */
    getMonthInChinese(): string;
    /** 日名，如 初一 / 十五 / 廿九 / 三十 */
    getDayInChinese(): string;
    /** 当日节日（库内置集合，本项目另有白名单收敛） */
    getFestivals(): string[];
    /** 当日节气名，非节气日返回空串 */
    getJieQi(): string;
    getSolar(): Solar;
  }

  export class LunarMonth {
    static fromYm(year: number, month: number): LunarMonth | null;
    /** 该农历月天数（29/30） */
    getDayCount(): number;
  }

  export class LunarYear {
    static fromYear(year: number): LunarYear;
    /** 闰月月份，无闰月返回 0 */
    getLeapMonth(): number;
    getMonths(): LunarMonth[];
  }
}