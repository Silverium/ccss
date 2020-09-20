import { CCSSProps, CCSSFunction, CCSSOptions } from '@cryptic-css/core'
// @ts-ignore
import { StyledComponent, StyledProps, StyledInterface } from '@types/styled-components'

export type UiProps = StyledProps<CCSSProps>
export type UiComponent = StyledComponent<'div', any, UiProps>
export type UiComponentFactories = {
    [TTag in keyof JSX.IntrinsicElements]: StyledComponent<TTag, any, UiProps>
}

export type UiType = UiComponent & UiComponentFactories

const noop = () => {}

// Do not use deprecated stuff please
const skipNativeTags = ['DatePickerIOS', 'DatePickerAndroid']

const isSupportedTag = (styled, tag, isNative) => {
    if (!isNative) return true
    else if (skipNativeTags.includes(tag)) {
        return false
    }

    // Non supported tags will simply fail to initialize
    try {
        styled[tag]('')
        return true
    } catch {
        return false
    }
}

type StyledCCSS = {
    Ui: UiType
    ccssd: (props: CCSSProps) => UiType
    ccss: any
}

type CreateStyledCCSS = (options: Partial<CCSSOptions>) => StyledCCSS

interface CreateCreator {
    (styled: StyledInterface, isNative?: boolean): CreateStyledCCSS
}

export const createCreator: CreateCreator = (
    styled,
    isNative = typeof navigator != 'undefined' && navigator.product == 'ReactNative'
) => ({ defaultProps = undefined, ...rest }) => {
    const __ccss = rest.__ccss as CCSSFunction
    const props = rest.props as CCSSProps
    const defaultTag = isNative ? 'View' : 'div'

    // Handle React stuff!
    // @ts-ignore
    props.theme = props.theme || noop
    // @ts-ignore
    props.children = props.children || noop

    const Ui = styled[defaultTag](__ccss)
    Ui.defaultProps = defaultProps
    const tagged = (tag = defaultTag) => (p: CCSSProps) => {
        const css = __ccss(p)
        return styled[tag]<CCSSProps>(() => css, __ccss)
    }
    const ccssd = tagged(defaultTag)

    // Recreates supported HTML tags (eg: Ui.section, Ui.ul)
    // eslint-disable-next-line no-restricted-syntax
    for (const tag in styled) {
        if (Object.prototype.hasOwnProperty.call(styled, tag) && isSupportedTag(styled, tag, isNative)) {
            try {
                Ui[tag] = styled[tag](__ccss)
                // @ts-ignore
                Ui[tag].defaultProps = defaultProps
                ccssd[tag] = tagged(tag)
                ccssd[tag].defaultProps = defaultProps
            } catch {}
        }
    }

    return {
        Ui,
        ccssd,
        ccss: __ccss
    }
}