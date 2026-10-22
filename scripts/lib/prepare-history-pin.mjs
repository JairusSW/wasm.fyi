export function prepareHistoryPin(pins,{engine,configuration,week}) {
  return pins.filter(pin => pin.engine === engine
    && pin.targetType === 'main'
    && pin.status === 'planned'
    && pin.configurations.includes(configuration)
    && (!week || pin.targetWeek === week))
    .sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))[0] || null;
}
