<script setup lang="ts">
import useSpellCheck from "@/renderer/hooks/useSpellCheck";
import { Switch } from "@renderer/components/ui/switch";

const { isSpellCheckEnabled, applySpellCheck } = useSpellCheck();
</script>

<template>
  <div class="SpellCheckSetterBox">
    <Switch
      :model-value="isSpellCheckEnabled"
      @update:model-value="(val) => applySpellCheck(val)"
      label="启用拼写检查"
    />
  </div>
</template>

<style lang="less" scoped>
.SpellCheckSetterBox {
  width: 100%;
}
</style>
