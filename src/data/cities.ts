/**
 * 城市列表（v1.3.0）：与云函数 weatherProxy 的中国天气网编码表保持一致。
 * 按汉语拼音首字母分组、组内按拼音升序排列，供城市选择弹层展示。
 */
export interface CityGroup {
  letter: string;
  cities: string[];
}

export const CITY_GROUPS: CityGroup[] = [
  { letter: 'B', cities: ['保定', '北京', '包头'] },
  { letter: 'C', cities: ['常州', '长春', '成都', '重庆'] },
  { letter: 'D', cities: ['大连', '东莞'] },
  { letter: 'F', cities: ['佛山'] },
  { letter: 'G', cities: ['广州', '桂林', '贵阳'] },
  { letter: 'H', cities: ['哈尔滨', '海口', '杭州', '合肥', '呼和浩特', '惠州'] },
  { letter: 'J', cities: ['嘉兴', '济南', '金华'] },
  { letter: 'K', cities: ['昆明'] },
  { letter: 'L', cities: ['拉萨', '兰州', '洛阳'] },
  { letter: 'N', cities: ['南京', '南昌', '南宁', '南通', '宁波'] },
  { letter: 'Q', cities: ['青岛', '泉州'] },
  { letter: 'S', cities: ['三亚', '上海', '深圳', '沈阳', '苏州', '石家庄'] },
  { letter: 'T', cities: ['天津', '太原', '唐山'] },
  { letter: 'W', cities: ['温州', '乌鲁木齐', '无锡', '武汉'] },
  { letter: 'X', cities: ['西安', '厦门', '西宁', '徐州'] },
  { letter: 'Y', cities: ['银川', '烟台'] },
  { letter: 'Z', cities: ['郑州', '中山', '珠海'] }
];

/** 平铺城市列表（保持拼音分组顺序） */
export const CITY_ALL: string[] = CITY_GROUPS.flatMap((g) => g.cities);
