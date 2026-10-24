# Debug Commands

Use these in the browser console.

## Setup Flow Debug

Enable:
```js
localStorage.setItem('wikid:debug-setup', '1')
```

Disable:
```js
localStorage.removeItem('wikid:debug-setup')
```

Check:
```js
localStorage.getItem('wikid:debug-setup')
```

## Block Duplication Debug

Enable:
```js
localStorage.setItem('wikid:debug-blocks', '1')
```

Disable:
```js
localStorage.removeItem('wikid:debug-blocks')
```

Check:
```js
localStorage.getItem('wikid:debug-blocks')
```

## Column Input Debug

Enable:
```js
localStorage.setItem('wikid:debug-columns', '1')
```

Disable:
```js
localStorage.removeItem('wikid:debug-columns')
```

Check:
```js
localStorage.getItem('wikid:debug-columns')
```

## Selection Jump Debug

Enable:
```js
localStorage.setItem('wikid:debug-selection', '1')
```

Disable:
```js
localStorage.removeItem('wikid:debug-selection')
```

Check:
```js
localStorage.getItem('wikid:debug-selection')
```

## Undo Debug

Enable:
```js
localStorage.setItem('wikid:debug-undo', '1')
```

Disable:
```js
localStorage.removeItem('wikid:debug-undo')
```

Check:
```js
localStorage.getItem('wikid:debug-undo')
```

## Disable All Debug Options

```js
localStorage.removeItem('wikid:debug-setup')
localStorage.removeItem('wikid:debug-blocks')
localStorage.removeItem('wikid:debug-columns')
localStorage.removeItem('wikid:debug-selection')
localStorage.removeItem('wikid:debug-undo')
```
