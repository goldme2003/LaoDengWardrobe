export default defineAppConfig({
  pages: [
    'pages/wardrobe/index',
    'pages/wardrobes/index',
    'pages/wardrobe-new/index',
    'pages/tryout/index',
    'pages/tryout-edit/index',
    'pages/diary/index',
    'pages/mine/index',
    'pages/profile/index',
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
        iconPath: 'assets/tabbar/wardrobe.png',
        selectedIconPath: 'assets/tabbar/wardrobe-selected.png'
      },
      {
        pagePath: 'pages/tryout/index',
        text: '试穿',
        iconPath: 'assets/tabbar/closet.png',
        selectedIconPath: 'assets/tabbar/closet-selected.png'
      },
      {
        pagePath: 'pages/diary/index',
        text: '日记',
        iconPath: 'assets/tabbar/diary.png',
        selectedIconPath: 'assets/tabbar/diary-selected.png'
      },
      {
        pagePath: 'pages/mine/index',
        text: '我的',
        iconPath: 'assets/tabbar/mine.png',
        selectedIconPath: 'assets/tabbar/mine-selected.png'
      }
    ]
  }
})
