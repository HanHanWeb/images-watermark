<script setup>
defineProps({
  modelValue: { type: String, default: 'bottom-right' },
})
defineEmits(['update:modelValue'])

const positions = [
  { key: 'top-left', label: '左上' },
  { key: 'top-center', label: '上' },
  { key: 'top-right', label: '右上' },
  { key: 'middle-left', label: '左' },
  { key: 'center', label: '居中' },
  { key: 'middle-right', label: '右' },
  { key: 'bottom-left', label: '左下' },
  { key: 'bottom-center', label: '下' },
  { key: 'bottom-right', label: '右下' },
]
</script>

<template>
  <div class="grid">
    <button
      v-for="p in positions"
      :key="p.key"
      type="button"
      class="cell"
      :class="{ active: modelValue === p.key }"
      @click="$emit('update:modelValue', p.key)"
    >
      {{ p.label }}
    </button>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.cell {
  height: 40px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
  transition: all 0.15s;
}
.cell:hover {
  border-color: #409eff;
  color: #409eff;
}
.cell.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
</style>
