export default defineAppConfig({
  pages: [
    'pages/wardrobe/index',
    'pages/tryout/index',
    'pages/diary/index',
    'pages/mine/index',
    'pages/wardrobes/index',
    'pages/add/index',
    'pages/detail/index',
    'pages/tryout-edit/index'
  ],
  window: {
    backgroundColor: '#FAF6F1',
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#FAF6F1',
    navigationBarTitleText: '老登衣柜',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#A39385',
    selectedColor: '#E8684A',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/wardrobe/index', text: '衣柜',  iconPath: 'assets/tabbar/wardrobe.svg',  selectedIconPath: 'assets/tabbar/wardrobe-selected.svg' },
      { pagePath: 'pages/tryout/index',   text: '备选',  iconPath: 'assets/tabbar/closet.svg',   selectedIconPath: 'assets/tabbar/closet-selected.svg' },
      { pagePath: 'pages/diary/index',    text: '日记',  iconPath: 'assets/tabbar/diary.svg',    selectedIconPath: 'assets/tabbar/diary-selected.svg' },
      { pagePath: 'pages/mine/index',     text: '我的',  iconPath: 'assets/tabbar/mine.svg',     selectedIconPath: 'assets/tabbar/mine-selected.svg' }
    ]
  }
})
