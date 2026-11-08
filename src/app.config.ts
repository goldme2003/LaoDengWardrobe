export default defineAppConfig({
  pages: [
    'pages/wardrobe/index',
    'pages/wardrobes/index',
    'pages/diary/index',
    'pages/mine/index',
    'pages/add/index',
    'pages/detail/index'
  ],
  window: {
    backgroundColor: '#F7F4EF',
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#F7F4EF',
    navigationBarTitleText: '老登衣柜',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#A39385',
    selectedColor: '#B07D50',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/wardrobe/index',
        text: '衣柜',
        iconPath: 'assets/tabbar/wardrobe.svg',
        selectedIconPath: 'assets/tabbar/wardrobe-selected.svg'
      },
      {
        pagePath: 'pages/wardrobes/index',
        text: '衣橱',
        iconPath: 'assets/tabbar/closet.svg',
        selectedIconPath: 'assets/tabbar/closet-selected.svg'
      },
      {
        pagePath: 'pages/diary/index',
        text: '日记',
        iconPath: 'assets/tabbar/diary.svg',
        selectedIconPath: 'assets/tabbar/diary-selected.svg'
      },
      {
        pagePath: 'pages/mine/index',
        text: '我的',
        iconPath: 'assets/tabbar/mine.svg',
        selectedIconPath: 'assets/tabbar/mine-selected.svg'
      }
    ]
  }
})
